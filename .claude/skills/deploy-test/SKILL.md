---
name: deploy-test
description: Выкатить текущий main на тест-сервер и прогнать smoke-тесты
disable-model-invocation: true
allowed-tools: Bash(just deploy-test), Bash(just smoke-test *), Bash(just test-logs *)
---
1. Выполни `just deploy-test`.
2. Выполни `just smoke-test`.
3. Если smoke-тесты падают — покажи `just test-logs server`, предложи причину, но ничего не меняй на сервере.
