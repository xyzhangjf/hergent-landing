// Global type declarations for Hergent Desktop renderer modules.
// These types tell TypeScript/TS Server about variables defined in
// <script> tags loaded before the current file.

// ===== Browser globals =====
declare var localStorage: Storage;
declare var document: Document;
declare var window: Window & {
  hermes: HermesAPI;
  hermes_on: HermesOnAPI;
  __hergent_secure_storage_loaded?: boolean;
  __hergent_secure_storage: SecureStorageExport;
  activateDevice: () => Promise<void>;
};
declare var console: Console;

// ===== Hermes preload API (exposed via contextBridge) =====
interface HermesAPI {
  platform: string;
  execute: (action: string, args: any) => Promise<any>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  selectFile: (opts?: any) => Promise<{ canceled: boolean; filePath: string | null }>;
  getVersion: () => Promise<string>;
  getCredits: () => Promise<{ credits: number; message?: string }>;
  getBillingHistory: () => Promise<BillingData>;
  activate: (code: string) => Promise<{ ok: boolean; tier?: string; message?: string }>;
  authSendCode: (phone: string) => Promise<{ success: boolean; detail?: string }>;
  authVerifyCode: (phone: string, code: string) => Promise<{ token?: string; user?: any; detail?: string }>;
  authWechatUrl: () => Promise<{ url?: string }>;
  authLogout: (token: string) => Promise<void>;
  authMe: (token: string) => Promise<{ id?: string } | null>;
  checkCli: () => Promise<{ available: boolean; version?: string }>;
  bootstrapHermes: () => Promise<{ success: boolean; error?: string }>;
  gatewayStatus: () => Promise<GatewayStatus>;
  notify: (title: string, body: string) => Promise<void>;
  openExternal: (url: string) => void;
  createPayment: (amount: number) => Promise<PaymentResult>;
  checkPayment: (orderId: string) => Promise<{ paid: boolean; credits_added?: number }>;
  devPay: (orderId: string, deviceId: string, amount: number) => Promise<DevPayResult>;
  [key: string]: any;
}

interface HermesOnAPI {
  stream: (cb: (data: StreamData) => void) => void;
  [key: string]: (cb: (...args: any[]) => void) => void;
}

interface GatewayStatus {
  running: boolean;
  ready?: boolean;
  url?: string | null;
  message?: string;
  platforms?: Record<string, { state: string }>;
}

interface BillingData {
  recharges?: Array<{ time: string; credits: number }>;
  usage?: Array<{ time: string; model: string; credits: number }>;
  balance?: number;
  total_recharged?: number;
  total_used?: number;
}

interface PaymentResult {
  success: boolean;
  order_id?: string;
  pay_url?: string;
  dev_mode?: boolean;
  error?: string;
}

interface DevPayResult {
  success?: boolean;
  duplicate?: boolean;
  error?: string;
}

interface StreamData {
  text?: string;
  type?: string;
  step?: number;
  total?: number;
  role?: string;
  status?: string;
  preview?: string;
  error?: string;
}

// ===== Secure Storage export =====
interface SecureStorageExport {
  _obfuscate: (plain: string) => string;
  _deobfuscate: (encoded: string) => string;
  _isSensitive: (key: string) => boolean;
}

// ===== Global functions from config.js =====
declare var TASK_TEMPLATES: Array<{ id: string; name: string; desc: string; freq: string; time: string; prompt: string; ico: string }>;
declare var FREQ_LABELS: Record<string, string>;
declare var CHANNEL_CARDS: Array<{ key: string; label: string; icon: string; desc: string; hl: string; fields: Array<{ id: string; label: string; placeholder: string }> }>;
declare var questionnaires: Record<string, any>;

// ===== Global functions from dialog.js =====
declare var _overlayStack: string[];
declare function showOverlay(id: string): void;
declare function hideOverlay(id: string): void;
declare function topOverlay(): string | null;
declare var DIALOG_ICONS: Record<string, string>;
declare function showDialog(icon: string, msg: string, confirmMode?: boolean): void | Promise<boolean>;
declare function closeDialog(): void;

// ===== Global functions from icons.js =====
declare var ICONS: Record<string, string>;

// ===== Global functions from node_modules =====
declare var QRCode: any;
