---
name: module
description: Выполнить промпт контура B из docs/prompts/README.md по шаблону docs/prompts/TEMPLATE-B.md
disable-model-invocation: true
argument-hint: "<B-номер> <каталог модуля>"
---
Выполни промпт $0 из таблицы docs/prompts/README.md для модуля $1.

1. Прочитай строку промпта $0 («Вход», «Выход»), docs/prompts/TEMPLATE-B.md, ADR и файлы спецификации, указанные во «Входе», и $1/STATUS.md, если он есть.
2. Составь план до 10 пунктов и список открытых вопросов. Остановись и покажи их — до кода.
3. После одобрения реализуй, запуская `just test` и `just lint` по ходу. Вопросы к спецификации записывай в docs/spec/OPEN-QUESTIONS.md, поведение не додумывай.
4. В конце обнови $1/STATUS.md (что сделано, что сломано, что дальше), docs/protocol/ при изменении контракта, и запусти субагент cleanroom-reviewer на $1.
