// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Проверка Kotlin-привязки uniffi на JVM (dev-контейнер x86_64): два устройства, одно сообщение.

import uniffi.s1_uniffi_ffi.Device
import uniffi.s1_uniffi_ffi.openmlsVersion

fun main() {
    val groupId = "spike-s1-kotlin".toByteArray()
    val a = Device("a-android")
    val b = Device("b-phone")

    val keyPackage = b.keyPackage()
    a.createGroup(groupId, null)
    val added = a.addMembers(groupId, listOf(keyPackage))
    a.mergePendingCommit(groupId)
    b.join(added.welcome!!)

    val ciphertext = a.send(groupId, "привет из Kotlin".toByteArray())
    val received = b.receive(ciphertext)
    val text = String(received.plaintext!!)
    println("openmls ${openmlsVersion()} через uniffi/Kotlin: ${received.sender} -> $text")
    println("участники: ${b.members(groupId).joinToString(", ")}, эпоха ${b.epoch(groupId)}")
}
