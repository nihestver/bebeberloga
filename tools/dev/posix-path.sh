# shellcheck shell=bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Подключается рецептами justfile на Windows через BASH_ENV; сам по себе не запускается.
# В Git for Windows каталоги Windows могут стоять в PATH раньше утилит Git — тогда sort, find и подобные
# команды оказываются программами из System32 с другим поведением. Файл ставит /usr/bin в начало PATH.
# На macOS и Linux ничего не делает.
case "${OSTYPE:-}" in
  msys* | cygwin*)
    case ":${PATH:-}" in
      :/usr/bin:*) ;;
      *) PATH="/usr/bin:${PATH:-}" ;;
    esac
    ;;
esac
