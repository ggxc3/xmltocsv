import { invoke } from "@tauri-apps/api/core";

export type Source =
  | { type: "date" }
  | { type: "time" }
  | { type: "measure"; tag: string }
  | { type: "constant"; value: string };

export interface Column {
  name: string;
  unit: string;
  source: Source;
  multiply?: number;
  offset?: number;
  triple: boolean;
}

export interface Profile {
  id: string;
  name: string;
  builtin: boolean;
  skip: number;
  fileName: string;
  columns: Column[];
  ignoredTags: string[];
}

export interface TagInfo {
  tag: string;
  units: string;
}

export interface Table {
  header: string[];
  units: string[];
  rows: string[][];
  totalPoints: number;
  skipped: number;
  missing: number;
}

export interface ConvertResult {
  output: string;
  rows: number;
  skipped: number;
  missing: number;
  unusedTags: TagInfo[];
}

export const api = {
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  saveProfile: (profile: Profile) => invoke<Profile>("save_profile", { profile }),
  deleteProfile: (id: string) => invoke<void>("delete_profile", { id }),
  exportProfile: (profile: Profile, path: string) => invoke<void>("export_profile", { profile, path }),
  importProfile: (path: string) => invoke<Profile>("import_profile", { path }),
  inspectXml: (path: string) => invoke<{ points: number; tags: TagInfo[] }>("inspect_xml", { path }),
  preview: (path: string, profile: Profile, rows: number) => invoke<Table>("preview", { path, profile, rows }),
  outputPath: (input: string, profile: Profile, dir?: string) =>
    invoke<string>("output_path", { input, profile, dir: dir ?? null }),
  convert: (input: string, output: string, profile: Profile) =>
    invoke<ConvertResult>("convert", { input, output, profile }),
};

/** Veličiny, ktoré posiela RANGER Neo v režime FM. Používajú sa ako ponuka v editore aj bez načítaného XML. */
export const KNOWN_TAGS: Record<string, { label: string; units: string }> = {
  LEVEL: { label: "Level", units: "dBuV" },
  MODULATIONPOWER: { label: "MPX Power", units: "dBr" },
  MPXFREQUENCYDEVIATION: { label: "Deviation MPX", units: "kHz" },
  LFREQUENCYDEVIATION: { label: "Deviation L", units: "kHz" },
  RFREQUENCYDEVIATION: { label: "Deviation R", units: "kHz" },
  STEREOPILOTFREQUENCYDEVIATION: { label: "Deviation Pilot", units: "kHz" },
  RDSFREQUENCYDEVIATION: { label: "Deviation RDS", units: "kHz" },
  LPLUSRFREQUENCYDEVIATION: { label: "Deviation L+R", units: "kHz" },
  LMINUSRFREQUENCYDEVIATION: { label: "Deviation L-R", units: "kHz" },
  LAUDIOLEVEL: { label: "Audio Level L", units: "kHz" },
  RAUDIOLEVEL: { label: "Audio Level R", units: "kHz" },
  LPLUSRAUDIOLEVEL: { label: "Audio Level L+R", units: "kHz" },
  LMINUSRAUDIOLEVEL: { label: "Audio Level L-R", units: "kHz" },
  OFFSET: { label: "RF Offset", units: "kHz" },
  RDSPHASE: { label: "RDS Phase", units: "º" },
  AMDEPTH: { label: "AM Depth", units: "%" },
};
