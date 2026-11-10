// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Комната LiveKit с E2EE кадров (encoded transforms в worker). Ключ в спайке статический:
// ключи из MLS и KeyProvider «на участника» — предмет спайка S2.

import { ExternalE2EEKeyProvider, Room, RoomEvent } from "livekit-client";
import E2EEWorker from "livekit-client/e2ee-worker?worker";

export const SPIKE_KEY = "s3-статический-ключ-спайка";

export interface Joined {
  room: Room;
  events: string[];
}

export async function join(
  roomName: string,
  identity: string,
  e2ee: boolean,
  key = SPIKE_KEY,
): Promise<Joined> {
  const env = await window.s3.env();
  const events: string[] = [];
  const note = (m: string): void => {
    events.push(`${Math.round(performance.now())} ${m}`);
  };
  let room: Room;
  if (e2ee) {
    const keyProvider = new ExternalE2EEKeyProvider({ ratchetWindowSize: 0, failureTolerance: -1 });
    room = new Room({
      adaptiveStream: false,
      dynacast: false,
      encryption: { keyProvider, worker: new E2EEWorker() },
    });
    await keyProvider.setKey(key);
    await room.setE2EEEnabled(true);
  } else {
    // Без шифрования — только для сравнительного замера добавки E2EE на стенде. В продукт эту ветку
    // не переносить: режима без E2EE нет (CLAUDE.md «Инварианты E2EE», FLOWS/08 «Деградация»).
    room = new Room({ adaptiveStream: false, dynacast: false });
  }
  room
    .on(RoomEvent.EncryptionError, (e) => note(`encryptionError ${e.message}`))
    .on(RoomEvent.ParticipantEncryptionStatusChanged, (on, p) =>
      note(`encryption ${p?.identity ?? "?"} ${on}`),
    )
    .on(RoomEvent.Disconnected, (r) => note(`disconnected ${r ?? ""}`))
    .on(RoomEvent.TrackSubscriptionFailed, (sid) => note(`subscriptionFailed ${sid}`));
  const token = await window.s3.token(roomName, identity);
  await room.connect(env.livekitUrl, token, { autoSubscribe: true });
  return { room, events };
}

/** Плоская копия нужных записей RTCStatsReport. */
export function pickStats(
  report: RTCStatsReport | undefined,
  types: string[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  report?.forEach((s: Record<string, unknown>) => {
    if (types.includes(String(s.type))) out.push({ ...s });
  });
  return out;
}
