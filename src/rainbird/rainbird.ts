import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { Agent as UndiciAgent } from 'undici';

export type RainbirdCommand = Record<string, unknown>;

const COMMAND = 'command';
const TYPE = 'type';
const LENGTH = 'length';
const RESPONSE = 'response';
const POSITION = 'position';
const DECODER = 'decoder';
const RESERVED_FIELDS = [COMMAND, TYPE, LENGTH, RESPONSE, DECODER];

const HEADERS = {
  'Accept-Language': 'en',
  'Accept-Encoding': 'gzip, deflate',
  'User-Agent': 'RainBird/2.0 CFNetwork/811.5.4 Darwin/16.7.0',
  Accept: '*/*',
  Connection: 'keep-alive',
  'Content-Type': 'application/octet-stream',
};

export interface ModelInfo {
  device_id: string;
  code: string;
  name: string;
  supports_water_budget: boolean;
  max_programs: number;
  max_run_times: number;
  max_stations: number;
  retries?: boolean;
}

export interface ModelAndVersion {
  modelId: string;
  protocolMajor: number;
  protocolMinor: number;
  modelInfo: ModelInfo;
}

export interface AvailableStations {
  activeSet: Set<number>;
  count: number;
}

export interface Schedule {
  controllerInfo: Record<string, number>;
  programInfo: Array<Record<string, number>>;
  programStartInfo: Array<Record<string, number>>;
  durations: Array<{ zone: number; durations: number[] }>;
}

export interface QueueState {
  currentProgram?: Record<string, unknown>;
  zones: Array<Record<string, number>>;
}

interface RainbirdResources {
  commands: Record<string, RainbirdCommand>;
  commandsById: Record<string, RainbirdCommand>;
  models: Record<string, ModelInfo>;
}

interface SipResources {
  ControllerCommands: Record<string, RainbirdCommand>;
  ControllerResponses: Record<string, RainbirdCommand>;
}

function loadResources(): RainbirdResources {
  const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources');
  const sipPath = path.join(baseDir, 'sipcommands.yaml');
  const modelsPath = path.join(baseDir, 'models.yaml');
  const sip = yaml.parse(fs.readFileSync(sipPath, 'utf8')) as SipResources;
  const models = yaml.parse(fs.readFileSync(modelsPath, 'utf8')) as ModelInfo[];

  const buildIdMap = (commands: Record<string, RainbirdCommand>): Record<string, RainbirdCommand> =>
    Object.entries(commands).reduce((acc, [key, content]) => {
      const commandId = content[COMMAND] as string;
      acc[commandId] = { ...content, [TYPE]: key };
      return acc;
    }, {} as Record<string, RainbirdCommand>);

  const controllerCommands = sip.ControllerCommands;
  const controllerResponses = sip.ControllerResponses;
  const commands = { ...controllerCommands, ...controllerResponses };
  const commandsById = { ...buildIdMap(controllerCommands), ...buildIdMap(controllerResponses) };
  const modelMap: Record<string, ModelInfo> = {};
  for (const info of models) {
    modelMap[String(info.device_id).toUpperCase()] = info;
  }
  if (!modelMap.UNKNOWN) {
    modelMap.UNKNOWN = {
      device_id: 'UNKNOWN',
      code: 'UNKNOWN',
      name: 'Unknown',
      supports_water_budget: false,
      max_programs: 0,
      max_run_times: 0,
      max_stations: 0,
      retries: false,
    };
  }
  return { commands, commandsById, models: modelMap };
}

const RESOURCES = loadResources();

function addPadding(data: string): Buffer {
  const blockSize = 16;
  const dataLength = data.length;
  const remainder = dataLength % blockSize;
  const charsToAdd = remainder === 0 ? 0 : blockSize - remainder;
  const padString = '\x10'.repeat(charsToAdd);
  return Buffer.from(`${data}${padString}`, 'utf8');
}

function encrypt(payload: string, password: string): Buffer {
  const hash = crypto.createHash('sha256').update(Buffer.from(password, 'utf8')).digest();
  const iv = crypto.randomBytes(16);
  const bodyWithSuffix = `${payload}\x00\x10`;
  const padded = addPadding(bodyWithSuffix);
  const hashedBody = crypto.createHash('sha256').update(Buffer.from(payload, 'utf8')).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', hash, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return Buffer.concat([hashedBody, iv, encrypted]);
}

function decrypt(data: Buffer, password: string): string {
  const hash = crypto.createHash('sha256').update(Buffer.from(password, 'utf8')).digest();
  const iv = data.subarray(32, 48);
  const encrypted = data.subarray(48);
  const decipher = crypto.createDecipheriv('aes-256-cbc', hash, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

class PayloadCoder {
  constructor(private readonly password: string | null) {}

  encodeCommand(method: string, params: Record<string, unknown>): Buffer {
    const request = JSON.stringify({
      id: Date.now(),
      jsonrpc: '2.0',
      method,
      params,
    });
    if (!this.password) {
      return Buffer.from(request, 'utf8');
    }
    return encrypt(request, this.password);
  }

  decodeCommand(content: Buffer): unknown {
    let payload = content.toString('utf8');
    if (this.password) {
      try {
        payload = decrypt(content, this.password);
        payload = payload.replaceAll('\x10', '').replaceAll('\x0A', '').replaceAll('\x00', '').trim();
      } catch (err) {
        const raw = content.toString('utf8').trim();
        if (raw.startsWith('{') && raw.endsWith('}')) {
          payload = raw;
        } else {
          const head = content.subarray(0, 48).toString('hex');
          const message = `Rain Bird decrypt failed (len=${content.length}). head=${head}`;
          const error = new Error(message);
          (error as Error & { cause?: unknown }).cause = err;
          throw error;
        }
      }
    }
    const response = JSON.parse(payload) as { error?: { message?: string }; result?: unknown };
    if (response?.error) {
      const message = response.error.message ?? 'Rain Bird responded with an error';
      throw new Error(message);
    }
    return response.result;
  }
}

class RainbirdHttpClient {
  private coder: PayloadCoder;
  private retryOnBusy = false;

  constructor(
    private readonly url: string,
    password: string | null,
    private readonly ssl: boolean,
    private readonly debug?: (message: string, ...params: unknown[]) => void,
  ) {
    this.coder = new PayloadCoder(password);
  }

  enableRetryOnBusy(): void {
    this.retryOnBusy = true;
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const body = this.coder.encodeCommand(method, params);
    const httpsDispatcher = this.ssl ? new UndiciAgent({ connect: { rejectUnauthorized: false } }) : undefined;

    const attempt = async () => {
      const init: RequestInit & { dispatcher?: UndiciAgent } = {
        method: 'POST',
        body: body as unknown as BodyInit,
        headers: HEADERS,
      };
      if (httpsDispatcher) {
        init.dispatcher = httpsDispatcher;
      }
      this.debug?.(`Rain Bird request ${method} -> ${this.url} (len=${body.length})`);
      const res = await fetch(this.url, init);
      if (res.status === 503) {
        const error = new Error('Rain Bird device is busy; wait and retry') as Error & { code?: number };
        error.code = 503;
        throw error;
      }
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Rain Bird device denied authentication; incorrect password');
        }
        throw new Error(`Rain Bird error: ${res.status} ${res.statusText}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      this.debug?.(`Rain Bird response ${method} <- ${this.url} (len=${buffer.length})`);
      return this.coder.decodeCommand(buffer);
    };

    if (!this.retryOnBusy) {
      return attempt();
    }

    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        return await attempt();
      } catch (err) {
        lastErr = err;
        const error = err as { code?: number };
        if (error?.code !== 503) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw lastErr;
  }
}

function decodeTemplate(data: string, cmdTemplate: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(cmdTemplate)) {
    const template = value as { [POSITION]?: number; [LENGTH]?: number };
    if (typeof template === 'object' && template[POSITION] !== undefined && template[LENGTH] !== undefined) {
      result[key] = parseInt(data.slice(template[POSITION], template[POSITION] + template[LENGTH]), 16);
    }
  }
  return result;
}

function decodeSchedule(data: string): Record<string, unknown> {
  const subcommand = parseInt(data.slice(4, 6), 16);
  const rest = data.slice(6);
  if (subcommand === 0) {
    if (rest.length < 8) {
      return {};
    }
    return {
      controllerInfo: {
        stationDelay: parseInt(rest.slice(0, 4), 16),
        rainDelay: parseInt(rest.slice(4, 6), 16),
        rainSensor: parseInt(rest.slice(6, 8), 16),
      },
    };
  }

  if ((subcommand & 16) === 16) {
    if (rest.length < 10) {
      return {};
    }
    const program = subcommand & ~16;
    const fields = Array.from({ length: rest.length / 2 }, (_, i) =>
      parseInt(rest.slice(i * 2, i * 2 + 2), 16),
    );
    return {
      programInfo: {
        program,
        daysOfWeekMask: fields[0],
        period: fields[1],
        synchro: fields[2],
        permanentDaysOff: fields[3],
        reserved: fields[4],
        frequency: fields[5],
      },
    };
  }

  if ((subcommand & 96) === 96) {
    if (rest.length < 4) {
      return {};
    }
    const program = subcommand & ~96;
    const entries = Array.from({ length: rest.length / 4 }, (_, i) =>
      parseInt(rest.slice(i * 4, i * 4 + 4), 16),
    );
    return {
      programStartInfo: {
        program,
        startTime: entries,
      },
    };
  }

  if ((subcommand & 128) === 128) {
    if (rest.length < 4) {
      return {};
    }
    const station = subcommand & ~128;
    const durations = Array.from({ length: rest.length / 4 }, (_, i) =>
      parseInt(rest.slice(i * 4, i * 4 + 4), 16),
    );
    const numPrograms = durations.length / 2;
    return {
      durations: [
        { zone: station * 2, durations: durations.slice(0, numPrograms) },
        { zone: station * 2 + 1, durations: durations.slice(numPrograms) },
      ],
    };
  }

  return { data };
}

function decodeQueue(data: string): Record<string, unknown> {
  const page = parseInt(data.slice(2, 4), 16);
  const rest = data.slice(4);
  if (page === 0) {
    if (data.length === 24) {
      const runtime = parseInt(data.slice(8, 12), 16);
      let program = parseInt(data.slice(18, 20), 16);
      if (program > 4) {
        program = 0;
      }
      return {
        program: {
          seconds: runtime,
          program,
          zone: parseInt(data.slice(16, 18), 16),
          active: runtime > 0,
        },
      };
    }
    if (data.length === 14) {
      return {
        program: {
          program: parseInt(rest.slice(0, 2), 16),
          running: Boolean(parseInt(rest.slice(2, 4), 16)),
          zonesRemaining: parseInt(rest.slice(4, 6), 16),
        },
      };
    }
    return { data };
  }

  if (page === 1) {
    const queue: Array<Record<string, number>> = [];
    if (data.length === 70) {
      for (let i = 0; i < 11; i++) {
        const base = i * 6;
        const zone = parseInt(data.slice(base + 4, base + 6), 16) & 31;
        const runtime = parseInt(data.slice(base + 6, base + 10), 16);
        if (zone) {
          queue.push({ zone, seconds: runtime });
        }
      }
    } else {
      for (let i = 0; i < 8; i++) {
        const base = i * 8;
        const program = parseInt(data.slice(base + 4, base + 6), 16);
        const zone = parseInt(data.slice(base + 6, base + 8), 16);
        let runtime = parseInt(data.slice(base + 8, base + 12), 16);
        if (runtime > 0) {
          runtime = ((runtime & 0xff00) >> 8) | ((runtime & 0xff) << 8);
        }
        if (zone) {
          queue.push({ program, zone, seconds: runtime });
        }
      }
    }
    return { zones: queue };
  }

  if (data.length === 100) {
    const queue: Array<Record<string, number>> = [];
    for (let i = 0; i < 8; i++) {
      const base = i * 12;
      const program = parseInt(data.slice(base + 4, base + 6), 16);
      const zone = parseInt(data.slice(base + 6, base + 8), 16);
      let runtime = parseInt(data.slice(base + 8, base + 12), 16);
      if (runtime > 0) {
        runtime = ((runtime & 0xff00) >> 8) | ((runtime & 0xff) << 8);
      }
      if (zone) {
        queue.push({ program, zone, seconds: runtime });
      }
    }
    return { zones: queue };
  }

  return { data };
}

function decodeResponse(data: string): Record<string, unknown> {
  const commandCode = data.slice(0, 2);
  const template = RESOURCES.commandsById[commandCode];
  if (!template) {
    return { data };
  }
  const decoder = template[DECODER] ?? 'decode_template';
  if (decoder === 'decode_schedule') {
    return { [TYPE]: template[TYPE], ...decodeSchedule(data) };
  }
  if (decoder === 'decode_queue') {
    return { [TYPE]: template[TYPE], ...decodeQueue(data) };
  }
  return { [TYPE]: template[TYPE], ...decodeTemplate(data, template as Record<string, unknown>) };
}

function encodeCommand(command: string, ...args: Array<number | string>): string {
  const commandSet = RESOURCES.commands[command];
  if (!commandSet) {
    throw new Error(`Command ${command} not available`);
  }

  const cmdCode = commandSet[COMMAND] as string;
  const length = commandSet[LENGTH] as number;
  if (!length || length < 1) {
    throw new Error(`Command missing length: ${command}`);
  }

  if (args.length > length) {
    throw new Error(`Too many parameters for ${command}`);
  }

  if (length === 1) {
    return cmdCode;
  }

  if ('parameter' in commandSet || 'parameterOne' in commandSet) {
    const values = args.map((arg) => (typeof arg === 'string' ? parseInt(arg, 16) : arg));
    const firstWidth = Math.max(0, (length - values.length) * 2);
    const firstHex = values.length > 0 ? values[0].toString(16).toUpperCase().padStart(firstWidth, '0') : '';
    const tailHex = values.slice(1).map((value) => value.toString(16).toUpperCase().padStart(2, '0')).join('');
    return `${cmdCode}${firstHex}${tailHex}`;
  }

  if (args.length > Math.max(0, length - 1)) {
    throw new Error(`Too many parameters for ${command}`);
  }

  let data = `${cmdCode}${'00'.repeat(length - 1)}`;

  const argumentFields = Object.entries(commandSet)
    .filter(([key, value]) => !RESERVED_FIELDS.includes(key)
      && typeof value === 'object'
      && value !== null
      && typeof (value as { [POSITION]?: number })[POSITION] === 'number'
      && typeof (value as { [LENGTH]?: number })[LENGTH] === 'number')
    .sort(([, left], [, right]) => {
      const leftPos = (left as { [POSITION]: number })[POSITION];
      const rightPos = (right as { [POSITION]: number })[POSITION];
      return leftPos - rightPos;
    });

  if (argumentFields.length === 0) {
    if (args.length === 1 && length > 2) {
      const value = typeof args[0] === 'string' ? parseInt(args[0], 16) : args[0];
      const fieldLength = (length - 1) * 2;
      const hex = value.toString(16).toUpperCase().padStart(fieldLength, '0').slice(-fieldLength);
      const start = 2;
      const end = start + fieldLength;
      data = `${data.slice(0, start)}${hex}${data.slice(end)}`;
      return data;
    }

    args.forEach((arg, idx) => {
      const value = typeof arg === 'string' ? parseInt(arg, 16) : arg;
      const hex = value.toString(16).toUpperCase().padStart(2, '0');
      const start = 2 + (idx * 2);
      data = `${data.slice(0, start)}${hex}${data.slice(start + 2)}`;
    });
    return data;
  }

  const argsList = [...args];
  for (const [, field] of argumentFields) {
    const arg = argsList.shift();
    if (arg === undefined) {
      continue;
    }

    const value = typeof arg === 'string' ? parseInt(arg, 16) : arg;
    const start = (field as { [POSITION]: number })[POSITION];
    const fieldLength = (field as { [LENGTH]: number })[LENGTH];
    const end = start + fieldLength;
    const hex = value.toString(16).toUpperCase().padStart(fieldLength, '0').slice(-fieldLength);
    data = `${data.slice(0, start)}${hex}${data.slice(end)}`;
  }

  return data;
}

export class RainbirdController {
  private localClient: RainbirdHttpClient;
  private model?: ModelAndVersion;
  private commandQueue: Promise<unknown> = Promise.resolve();

  constructor(localClient: RainbirdHttpClient, private readonly debug?: (message: string, ...params: unknown[]) => void) {
    this.localClient = localClient;
  }

  static async create(
    host: string,
    password: string,
    log?: { debug: (message: string, ...params: unknown[]) => void; warn: (message: string, ...params: unknown[]) => void },
    debugEnabled = false,
  ): Promise<RainbirdController> {
    const normalized = host.trim().replace(/\/$/, '').replace(/^https?:\/\//, '');
    const httpsUrl = `https://${normalized}/stick`;
    const httpUrl = `http://${normalized}/stick`;

    const debug = debugEnabled && log ? log.debug.bind(log) : undefined;
    const httpsClient = new RainbirdHttpClient(httpsUrl, password, true, debug);
    const controller = new RainbirdController(httpsClient, debug);
    try {
      await controller.getModelAndVersion();
      return controller;
    } catch (err) {
      const message = String((err as Error)?.message ?? '').toLowerCase();
      const maybeConn = message.includes('econnrefused')
        || message.includes('connect')
        || message.includes('tls')
        || message.includes('ssl')
        || message.includes('certificate');
      if (!maybeConn) {
        throw err;
      }
      // fall through to HTTP
    }

    const httpClient = new RainbirdHttpClient(httpUrl, password, false, debug);
    const httpController = new RainbirdController(httpClient, debug);
    await httpController.getModelAndVersion();
    return httpController;
  }

  async getModelAndVersion(): Promise<ModelAndVersion> {
    const response = await this.processCommand('ModelAndVersionRequest') as Record<string, number>;
    const modelId = response.modelID?.toString(16).toUpperCase().padStart(4, '0') ?? response.modelID;
    const modelInfo = RESOURCES.models[modelId] ?? RESOURCES.models.UNKNOWN;
    const model = {
      modelId,
      protocolMajor: response.protocolRevisionMajor,
      protocolMinor: response.protocolRevisionMinor,
      modelInfo,
    } as ModelAndVersion;
    this.model = model;
    if (modelInfo.retries) {
      this.localClient.enableRetryOnBusy();
    }
    return model;
  }

  async getAvailableStations(): Promise<AvailableStations> {
    const response = await this.processCommand('AvailableStationsRequest', 0) as Record<string, number>;
    const mask = response.setStations?.toString(16).toUpperCase().padStart(8, '0') ?? response.setStations;
    const activeSet = new Set<number>();
    let rest = mask;
    let index = 1;
    while (rest.length > 0) {
      const current = parseInt(rest.slice(0, 2), 16);
      rest = rest.slice(2);
      for (let i = 0; i < 8; i++) {
        if ((1 << i) & current) {
          activeSet.add(index);
        }
        index += 1;
      }
    }
    return { activeSet, count: mask.length * 4 };
  }

  async getSerialNumber(): Promise<string> {
    const response = await this.processCommand('SerialNumberRequest') as Record<string, number>;
    return response.serialNumber?.toString(16).toUpperCase().padStart(16, '0') ?? String(response.serialNumber ?? '');
  }

  async getCurrentIrrigationState(): Promise<boolean> {
    const response = await this.processCommand('CurrentIrrigationStateRequest') as Record<string, number>;
    return Boolean(response.irrigationState);
  }

  async getRainSensorState(): Promise<boolean> {
    const response = await this.processCommand('CurrentRainSensorStateRequest') as Record<string, number>;
    return Boolean(response.sensorState);
  }

  async getRainDelay(): Promise<number> {
    const response = await this.processCommand('RainDelayGetRequest') as Record<string, number>;
    return Number(response.delaySetting ?? 0);
  }

  async setRainDelay(days: number): Promise<void> {
    await this.processCommand('RainDelaySetRequest', days);
  }

  async getActiveStations(): Promise<number[]> {
    const response = await this.processCommand('CurrentStationsActiveRequest', 0) as Record<string, number>;
    const mask = response.activeStations?.toString(16).toUpperCase().padStart(8, '0') ?? response.activeStations;
    const active: number[] = [];
    let rest = mask;
    let index = 1;
    while (rest.length > 0) {
      const current = parseInt(rest.slice(0, 2), 16);
      rest = rest.slice(2);
      for (let i = 0; i < 8; i++) {
        if ((1 << i) & current) {
          active.push(index);
        }
        index += 1;
      }
    }
    return active;
  }

  async stopIrrigation(): Promise<void> {
    await this.processCommand('StopIrrigationRequest');
  }

  async startZone(zone: number, minutes: number): Promise<void> {
    await this.processCommand('ManuallyRunStationRequest', zone, minutes);
  }

  async stackZone(zone: number, minutes: number): Promise<void> {
    await this.processCommand('StackManuallyRunStationRequest', 0, zone, minutes);
  }

  async startProgram(program: number): Promise<void> {
    await this.processCommand('ManuallyRunProgramRequest', program);
  }

  async getWaterBudget(program: number): Promise<number> {
    const response = await this.processCommand('WaterBudgetRequest', program) as Record<string, number>;
    return Number(response.seasonalAdjust ?? 0);
  }

  async setWaterBudget(program: number, percent: number): Promise<void> {
    const normalized = Math.max(0, Math.min(300, Math.floor(percent)));
    await this.processCommand('WaterBudgetSet', program, normalized);
  }

  async getCurrentQueue(): Promise<QueueState> {
    const page0 = await this.processCommand('CurrentQueueRequest', 0) as Record<string, unknown>;
    const page1 = await this.processCommand('CurrentQueueRequest', 1) as Record<string, unknown>;
    const zones = Array.isArray(page1?.zones) ? page1.zones as Array<Record<string, number>> : [];
    const currentProgram = (page0 && typeof page0 === 'object' && 'program' in page0)
      ? page0.program as Record<string, unknown>
      : undefined;
    return { currentProgram, zones };
  }

  async getSchedule(): Promise<Schedule> {
    const model = this.model ?? (await this.getModelAndVersion());
    let maxPrograms = model.modelInfo.max_programs;
    if (!maxPrograms || maxPrograms < 1) {
      maxPrograms = 4;
    }
    const stations = await this.getAvailableStations();
    let maxStations = model.modelInfo.max_stations;
    if (!maxStations) {
      maxStations = Math.min(stations.count, 22);
    }
    const activeStationsSummary = [...stations.activeSet].sort((a, b) => a - b).join(',');
    this.debug?.(
      `Schedule scan parameters: model=${model.modelId}, maxPrograms=${maxPrograms}, `
      + `maxStations=${maxStations}, activeStations=${activeStationsSummary}`,
    );

    const commands: string[] = ['00'];
    for (let program = 0; program < maxPrograms; program++) {
      commands.push((0x10 | program).toString(16).padStart(4, '0'));
    }
    for (let program = 0; program < maxPrograms; program++) {
      commands.push((0x60 | program).toString(16).padStart(4, '0'));
    }
    for (let zonePage = 0; zonePage < Math.ceil(maxStations / 2); zonePage++) {
      commands.push((0x80 | zonePage).toString(16).padStart(4, '0'));
    }

    const schedule: Schedule = {
      controllerInfo: {},
      programInfo: [],
      programStartInfo: [],
      durations: [],
    };

    let durationNakSeen = false;
    for (const command of commands) {
      const result = await this.processCommand('RetrieveScheduleRequest', parseInt(command, 16));
      if (!result || typeof result !== 'object') {
        this.debug?.(`Schedule command ${command}: no object result`);
        continue;
      }
      const typed = result as Record<string, unknown>;
      this.debug?.(`Schedule command ${command}: keys=${Object.keys(typed).join(',')}`);

      const commandValue = parseInt(command, 16);
      const isDurationPage = commandValue >= 0x80;
      if (isDurationPage && typeof typed.NAKCode === 'number') {
        this.debug?.(`Schedule command ${command}: duration scan stopped by NAKCode=${typed.NAKCode}`);
        durationNakSeen = true;
        break;
      }

      if (typed.controllerInfo) {
        schedule.controllerInfo = { ...schedule.controllerInfo, ...(typed.controllerInfo as Record<string, number>) };
      }
      if (typed.programInfo) {
        schedule.programInfo.push(typed.programInfo as Record<string, number>);
      }
      if (typed.programStartInfo) {
        schedule.programStartInfo.push(typed.programStartInfo as Record<string, number>);
      }
      if (typed.durations) {
        for (const entry of typed.durations as Array<{ zone: number; durations: number[] }>) {
          const zone1 = entry.zone;
          const zone2 = entry.zone + 1;
          if (!stations.activeSet.has(zone1) && !stations.activeSet.has(zone2)) {
            this.debug?.(`Skipping schedule durations for non-active zone index=${entry.zone}`);
            continue;
          }
          const resolvedZone = stations.activeSet.has(zone1) ? zone1 : zone2;
          schedule.durations.push({ zone: resolvedZone, durations: entry.durations });
        }
      }
    }

    if (durationNakSeen) {
      this.debug?.('Duration page scan ended at first NAK response.');
    }

    const durationByZone = new Map<number, number[]>();
    for (const entry of schedule.durations) {
      const current = durationByZone.get(entry.zone) ?? Array.from({ length: maxPrograms }, () => 0);
      const incoming = entry.durations.slice(0, maxPrograms);
      for (let i = 0; i < maxPrograms; i++) {
        const next = incoming[i] ?? 0;
        if (current[i] === 0 && next > 0) {
          current[i] = next;
        }
      }
      durationByZone.set(entry.zone, current);
    }
    schedule.durations = [...durationByZone.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([zone, durations]) => ({ zone, durations }));

    this.debug?.(
      `Schedule result summary: programInfo=${schedule.programInfo.length}, `
      + `programStartInfo=${schedule.programStartInfo.length}, durations=${schedule.durations.length}`,
    );
    return schedule;
  }

  private async processCommand(command: string, ...args: Array<number | string>): Promise<unknown> {
    const run = async (): Promise<unknown> => {
      const payload = encodeCommand(command, ...args);
      const length = RESOURCES.commands[command][LENGTH];
      const result = await this.localClient.request('tunnelSip', { data: payload, length });
      if (!result || typeof result !== 'object' || !('data' in (result as Record<string, unknown>))) {
        return result;
      }
      const data = (result as { data?: string }).data;
      if (!data) {
        return result;
      }
      return decodeResponse(data);
    };

    const next = this.commandQueue.then(run, run);
    this.commandQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}
