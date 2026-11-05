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
- иконки интерфейса — open-source набор (Lucide, Tabler или Phosphor), подключаемый пакетом; набор и
  его лицензия фиксируются при выборе в B8;
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
