// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Общий сценарий для Node и Electron: устройство A создаёт группу, добавляет B по KeyPackage,
// B входит по Welcome, оба шифруют и расшифровывают по одному сообщению.
// Возвращает строки для вывода, чтобы один и тот же код работал в обоих окружениях.

export function exchange(addon) {
  const out = [];
  const groupId = Buffer.from("spike-s1-dm");
  const a = new addon.Device("alice-laptop");
  const b = new addon.Device("bob-phone");

  const kpB = b.keyPackage();
  a.createGroup(groupId, null);
  const added = a.addMembers(groupId, [kpB]);
  a.mergePendingCommit(groupId);
  b.join(added.welcome);
  out.push(`версия openmls: ${addon.openmlsVersion()}`);
  out.push(`эпоха после добавления: A=${a.epoch(groupId)} B=${b.epoch(groupId)}`);
  out.push(`участники у B: ${b.members(groupId).join(", ")}`);

  const ct1 = a.send(groupId, Buffer.from("привет от ноутбука"));
  const r1 = b.receive(ct1);
  out.push(`B получил (${ct1.length} байт шифртекста) от ${r1.sender}: ${r1.plaintext.toString("utf8")}`);

  const ct2 = b.send(groupId, Buffer.from("привет от телефона"));
  const r2 = a.receive(ct2);
  out.push(`A получил (${ct2.length} байт шифртекста) от ${r2.sender}: ${r2.plaintext.toString("utf8")}`);

  const sa = a.exportSecret(groupId, "spike-s1", Buffer.alloc(0), 32);
  const sb = b.exportSecret(groupId, "spike-s1", Buffer.alloc(0), 32);
  out.push(`exporter-секрет совпадает: ${sa.equals(sb)}`);
  return out;
}
