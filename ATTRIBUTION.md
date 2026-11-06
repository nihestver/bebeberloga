# Ассеты и их авторы

Каждый файл-ассет в репозитории — изображение, иконка, шрифт, звук или видео — записан здесь с
автором, источником и лицензией. `just attribution` (входит в `just cleanroom` и в CI) падает, если
файл-ассет под git не найден в таблице или строка таблицы ссылается на файл, которого нет.

**Правило:** в Bebeberloga нет ассетов сторонних мессенджеров — ни иконок, ни изображений, ни
шрифтов, ни звуков (включая звуки уведомлений и soundboard), ни скриншотов. Каждый ассет — либо
собственная работа участников проекта, либо сторонний материал под свободной лицензией: OSI-лицензия,
CC0 или общественное достояние, Creative Commons с правом распространения, SIL OFL для шрифтов.
Строка добавляется в том же коммите, что и файл. Единственное исключение из свободных лицензий —
фирменные знаки в `brand/` ([`LICENSES/LicenseRef-Bebeberloga-Brand.txt`](LICENSES/LicenseRef-Bebeberloga-Brand.txt)).

Не хранятся в репозитории и поэтому не попадают в таблицу:

- шрифты Unbounded, Nunito и JetBrains Mono — подключаются пакетами `@fontsource/*` (SIL OFL 1.1,
  [`BRAND.md`](BRAND.md));
- иконки интерфейса — набор Lucide, пакет `lucide-react` (ISC; иконки из проекта Feather — MIT),
  [ADR-0023](docs/adr/0023-ui-primitives-and-icons.md). Это npm-зависимость, а не ассет репозитория.
  Иконки, которых в наборе нет, — собственные, лежат в `design/icons/` и записаны в таблице;
- звуки soundboard, которые загружают администраторы и участники инстанса. Встроенные звуки, если
  они появятся, записываются сюда.

| Файл | Автор | Источник | Лицензия | Примечание |
|---|---|---|---|---|
| `brand/bebeberloga-icon.svg` | Участники Bebeberloga | Оригинальная работа для проекта | LicenseRef-Bebeberloga-Brand | Иконка приложения |
| `brand/bebeberloga-icon-1024.png` | Участники Bebeberloga | Растровая версия `bebeberloga-icon.svg` | LicenseRef-Bebeberloga-Brand | Иконка приложения, 1024 × 1024 |
| `brand/bebeberloga-logo-for-dark.svg` | Участники Bebeberloga | Оригинальная работа для проекта | LicenseRef-Bebeberloga-Brand | Логотип для тёмного фона |
| `brand/bebeberloga-logo-for-light.svg` | Участники Bebeberloga | Оригинальная работа для проекта | LicenseRef-Bebeberloga-Brand | Логотип для светлого фона |
| `brand/bebeberloga-symbol.svg` | Участники Bebeberloga | Оригинальная работа для проекта | LicenseRef-Bebeberloga-Brand | Символ без фона |
| `brand/bebeberloga-symbol-1024.png` | Участники Bebeberloga | Растровая версия `bebeberloga-symbol.svg` | LicenseRef-Bebeberloga-Brand | Символ без фона, 1024 × 1024 |
| `brand/bebeberloga-wordmark-for-dark.svg` | Участники Bebeberloga | Оригинальная работа для проекта | LicenseRef-Bebeberloga-Brand | Надпись для тёмного фона |
| `brand/bebeberloga-wordmark-for-light.svg` | Участники Bebeberloga | Оригинальная работа для проекта | LicenseRef-Bebeberloga-Brand | Надпись для светлого фона |
| `brand/favicon.svg` | Участники Bebeberloga | Оригинальная работа для проекта | LicenseRef-Bebeberloga-Brand | Вкладка браузера |
| `brand/favicon.ico` | Участники Bebeberloga | Растровая версия `favicon.svg` | LicenseRef-Bebeberloga-Brand | Вкладка браузера, мелкие размеры |
| `design/icons/soundboard.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Иконка soundboard: динамик со звёздочкой |
| `design/avatars/bear.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «медведь» (docs/protocol/AVATARS.md) |
| `design/avatars/fox.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «лиса» (docs/protocol/AVATARS.md) |
| `design/avatars/hare.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «заяц» (docs/protocol/AVATARS.md) |
| `design/avatars/owl.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «сова» (docs/protocol/AVATARS.md) |
| `design/avatars/hedgehog.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «ёж» (docs/protocol/AVATARS.md) |
| `design/avatars/squirrel.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «белка» (docs/protocol/AVATARS.md) |
| `design/avatars/wolf.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «волк» (docs/protocol/AVATARS.md) |
| `design/avatars/moose.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «лось» (docs/protocol/AVATARS.md) |
| `design/avatars/badger.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «барсук» (docs/protocol/AVATARS.md) |
| `design/avatars/mouse.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «мышь» (docs/protocol/AVATARS.md) |
| `design/avatars/beaver.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «бобёр» (docs/protocol/AVATARS.md) |
| `design/avatars/lynx.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «рысь» (docs/protocol/AVATARS.md) |
| `design/avatars/frog.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «лягушка» (docs/protocol/AVATARS.md) |
| `design/avatars/bee.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «пчела» (docs/protocol/AVATARS.md) |
| `design/avatars/snail.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «улитка» (docs/protocol/AVATARS.md) |
| `design/avatars/bird.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «птица» (docs/protocol/AVATARS.md) |
| `design/avatars/teapot.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «чайник» (docs/protocol/AVATARS.md) |
| `design/avatars/mug.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «кружка» (docs/protocol/AVATARS.md) |
| `design/avatars/honey.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «горшочек мёда» (docs/protocol/AVATARS.md) |
| `design/avatars/lantern.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «фонарь» (docs/protocol/AVATARS.md) |
| `design/avatars/cone.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «шишка» (docs/protocol/AVATARS.md) |
| `design/avatars/mushroom.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «гриб» (docs/protocol/AVATARS.md) |
| `design/avatars/acorn.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «жёлудь» (docs/protocol/AVATARS.md) |
| `design/avatars/leaf.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «лист» (docs/protocol/AVATARS.md) |
| `design/avatars/campfire.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «костёр» (docs/protocol/AVATARS.md) |
| `design/avatars/berry.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «ягоды» (docs/protocol/AVATARS.md) |
| `design/avatars/spruce.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «ель» (docs/protocol/AVATARS.md) |
| `design/avatars/mitten.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «варежка» (docs/protocol/AVATARS.md) |
| `design/avatars/pillow.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «подушка» (docs/protocol/AVATARS.md) |
| `design/avatars/candle.svg` | @nihestver | Оригинальная работа для проекта | CC-BY-SA-4.0 | Встроенный аватар «свеча» (docs/protocol/AVATARS.md) |
