---
name: pr
description: Закоммитить изменения текущей ветки по правилам проекта (Conventional Commits + DCO) и открыть pull request с чеклистом
disable-model-invocation: true
argument-hint: "[краткое описание]"
allowed-tools: Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git add *), Bash(git commit *), Bash(git switch *), Bash(git fetch *), Bash(just *), Bash(gh pr create *), Bash(gh pr view *), Bash(gh pr checks *), Bash(gh run *)
---
1. Если ты на `main` или на ветке, PR которой уже влит (`gh pr view --json state` показывает `MERGED`), — `git fetch origin` и создай новую ветку от `origin/main` по смыслу изменений (`feat/…`, `fix/…`, `docs/…`, `spike/…`): `git switch -c <ветка> origin/main`. После merge ветка на GitHub удаляется; push во влитую ветку создаст её заново.
2. `git status` и `git diff --stat`: покажи, что попадёт в коммит. Секреты (`.env`, ключи) и сгенерированные артефакты не добавляй.
3. Прогони `just lint` и `just test`; если падают — остановись и покажи ошибки.
4. Закоммить логическими частями: `git commit -s -m "<type>(<scope>): <описание>"` (типы — feat, fix, docs, chore, refactor, test, perf, build, ci, spike; scope — модуль). Описание по-английски или по-русски, коротко. $ARGUMENTS — подсказка для описания.
5. `git push -u origin <ветка>` — эта команда спросит подтверждение, это нормально.
6. `gh pr create` с заполненным шаблоном .github/pull_request_template.md: что сделано, какой промпт, разделы SCREENS/FLOWS (для UI — таблица «раздел → файл → скриншот»), результаты ревью субагентов, что отложено.
7. Покажи ссылку на PR.
8. `gh pr checks --watch`. Если есть упавшие проверки — `gh run view <id> --log-failed`, исправь причину, закоммить (`git commit -s`), запроси push. Повторяй до зелёного, но не больше 3 попыток; потом остановись и покажи, что осталось.
9. Merge не делай.
