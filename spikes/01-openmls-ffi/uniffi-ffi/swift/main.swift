// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Проверка Swift-привязки uniffi на macOS-хосте: два устройства, одно сообщение.
// Сгенерированный s1_uniffi_ffi.swift компилируется вместе с этим файлом.

import Foundation

let groupId = Data("spike-s1-swift".utf8)
let a = try Device(name: "a-mac")
let b = try Device(name: "b-phone")

let keyPackage = try b.keyPackage()
try a.createGroup(groupId: groupId, externalSender: nil)
let added = try a.addMembers(groupId: groupId, keyPackages: [keyPackage])
try a.mergePendingCommit(groupId: groupId)
_ = try b.join(welcome: added.welcome!)

let ciphertext = try a.send(groupId: groupId, plaintext: Data("привет из Swift".utf8))
let received = try b.receive(message: ciphertext)
let text = String(decoding: received.plaintext ?? Data(), as: UTF8.self)
print("openmls \(openmlsVersion()) через uniffi/Swift: \(received.sender ?? "?") -> \(text)")
print("участники: \(try b.members(groupId: groupId).joined(separator: ", ")), эпоха \(try b.epoch(groupId: groupId))")
