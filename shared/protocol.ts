// Wire protocol shared between client and server (JSON over WebSocket).

export const TOOLS = ['brush', 'marker', 'spray', 'pixel', 'spores'] as const;
export type ToolId = 0 | 1 | 2 | 3 | 4;
export const MAX_SIZE = 80; // cm
export const MIN_SIZE = 2;
export const MAX_STROKE_NUMS = 400; // u,v pairs * 2
export const SEND_HZ = 8;

/** Stroke as stored/transmitted: [tool, color, size(cm), seed, pts(cm ints u,v,u,v...)] */
export type StrokeData = [number, number, number, number, number[]];

export interface PlayerInfo {
  id: string; // connection id
  uid: string; // stable user id ("tg:123" / "g:abcd")
  name: string;
  photo: string | null; // telegram photo url (proxied by client)
}

/** Compact player state: [id, x, y, z, yaw, pitch, flags] ; flags: 1 crouch, 2 moving, 4 drawing */
export type PState = [string, number, number, number, number, number, number];

export type ClientMsg =
  | { t: 'p'; s: [number, number, number, number, number, number] } // x,y,z,yaw,pitch,flags
  | { t: 's'; p: string; d: StrokeData }
  | { t: 'door'; id: string }
  | { t: 'rename'; name: string }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; you: PlayerInfo; players: PlayerInfo[]; states: PState[]; doors: Record<string, boolean>; panels: Record<string, number>; strokes: number }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: string }
  | { t: 'ps'; d: PState[] }
  | { t: 's'; p: string; d: StrokeData; by: string }
  | { t: 'door'; id: string; open: boolean }
  | { t: 'rename'; id: string; name: string }
  | { t: 'pong' }
  | { t: 'err'; m: string };

export const F_CROUCH = 1, F_MOVING = 2, F_DRAWING = 4;
