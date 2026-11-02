---
name: pr
description: Закоммитить изменения текущей ветки по правилам проекта (Conventional Commits + DCO) и открыть pull request с чеклистом
disable-model-invocation: true
argument-hint: "[краткое описание]"
allowed-tools: Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git add *), Bash(git commit *), Bash(git switch *), Bash(just *), Bash(gh pr create *), Bash(gh pr view *)
---
1. Если ты на `main` — создай ветку по смыслу изменений (`feat/…`, `fix/…`, `docs/…`, `spike/…`) и переключись на неё.
2. `git status` и `git diff --stat`: покажи, что попадёт в коммит. Секреты (`.env`, ключи) и сгенерированные артефакты не добавляй.
3. Прогони `just lint` и `just test`; если падают — остановись и покажи ошибки.
4. Закоммить логическими частями: `git commit -s -m "<type>(<scope>): <описание>"` (типы — feat, fix, docs, chore, refactor, test, perf, build, ci, spike; scope — модуль). Описание по-английски или по-русски, коротко. $ARGUMENTS — подсказка для описания.
5. `git push -u origin <ветка>` — эта команда спросит подтверждение, это нормально.
6. `gh pr create` с заполненным шаблоном .github/pull_request_template.md: что сделано, какой промпт, разделы SCREENS/FLOWS (для UI — таблица «раздел → файл → скриншот»), результаты ревью субагентов, что отложено.
7. Покажи ссылку на PR. Merge не делай.
