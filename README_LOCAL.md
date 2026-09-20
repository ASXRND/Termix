# README_LOCAL.md — локальная сборка Termix (форк)

Документ описывает **только эту локальную сборку**: что было сломано в исходном
проекте, что именно здесь исправлено, как пересобрать и как кастомизировать.
Всё, что написано про проблемы — проверенные на этой машине факты, а не
предположения.

Проект чужой (Apache License 2.0), но у нас есть **свой форк**:
`origin` → https://github.com/ASXRND/Termix, `upstream` → чужой репозиторий.
Все правки лежат в ветке `local/macos-pty-fixes` и запушены в форк (раздел 11).

| Параметр                    | Значение                                                         |
| --------------------------- | ---------------------------------------------------------------- |
| Upstream                    | https://github.com/Termix-SSH/Termix (`main`)                    |
| Коммит клона                | `9c04860` (18.09.2026, `chore: sync Crowdin translations`)       |
| Версия проекта              | 2.7.1                                                            |
| Electron / electron-builder | 43.4.1 / 26.15.3                                                 |
| node-pty                    | 1.1.0                                                            |
| Форк (`origin`)             | https://github.com/ASXRND/Termix                                 |
| Ветка с правками            | `local/macos-pty-fixes` (трекает `origin/local/macos-pty-fixes`) |
| Сборка на                   | macOS 27.0, arm64 (Xcode 26.6, Node v24.16.0, npm 12.0.2)        |

---

## 0. Статус на 19.09.2026

| Что                              | Состояние                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `/Applications/Termix.app`       | собрано из этого клона, ad-hoc подписано, **работает**                       |
| Локальный терминал               | проверен трижды (GUI-репро, упакованное приложение, копия в `/Applications`) |
| `spawn-helper` внутри приложения | `-rwxr-xr-x` + пропатченная версия (см. раздел 3.1)                          |
| Данные (хосты, ключи)            | на месте: `~/Library/Application Support/termix`                             |
| Homebrew-версия                  | удалена, `brew list --cask` её не показывает                                 |
| Форк и ветка                     | https://github.com/ASXRND/Termix → `local/macos-pty-fixes` запушена          |
| Бэкап ветки                      | `~/Desktop/termix-local-fixes.bundle` (12 МБ, `git bundle verify` → ok)      |
| Коммиты                          | `554f7d1` (фиксы), `8186ce6` и последующие `docs:` — раздел 12               |

---

## 1. Где что лежит (важно не путать)

| Путь                                                                    | Что это                                                                                                     | Нужен?                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `/Users/aleksandrhohon/Desktop/development_locall/termix`               | **клон исходников** (1,6 ГБ: `node_modules`, `release`, `dist`)                                             | Да — для пересборки и правок кода |
| `/Applications/Termix.app`                                              | **установленное приложение** (собрано из клона, ad-hoc подписано)                                           | Да — этим пользуемся              |
| `~/Library/Application Support/termix`                                  | **данные приложения**: `server-data/db.sqlite.encrypted` (хосты, ключи), `termix-main.log`, сессии, uploads | Да — это твои данные              |
| `~/Library/Application Support/Termix`                                  | **тот же самый каталог**: APFS не различает регистр, inode совпадает (`79982564`)                           | Это не «остатки» и не дубликат    |
| `~/Library/Caches/Homebrew/downloads/…--termix_macos_universal_dmg.dmg` | единственный остаток от удалённой brew-версии (скачанный образ в кэше Homebrew)                             | Не нужен, можно удалить           |

Дополнительно: `release/mac-arm64/Termix.app` внутри клона — «черновик» сборки,
из которого приложение копируется в `/Applications`. Оба `.app` существуют
одновременно, это нормально.

**Разные вещи с одинаковым именем:** `termix` в клоне на Рабочем столе — это
исходный код; `termix` в `~/Library/Application Support/` — это данные
приложения. Общего между ними ничего, кроме имени.

**Как запускать приложение:**

```bash
open -a Termix          # или иконка в Launchpad/Dock
```

Клон для запуска **не нужен**. Он нужен только для пересборки: если его удалить,
приложение продолжит работать (вся нативная часть лежит внутри `.app`), но
пропадёт возможность править код и пересобирать.

---

## 2. Исходная проблема

Симптом:

```
Error invoking remote method 'local-terminal-start': Error: posix_spawnp failed.
```

Локальный терминал не открывался вообще, при том что SSH-хосты работали.
Сообщение вводит в заблуждение: `posix_spawnp` в большинстве случаев даже не
вызывался — это зашитая строка на любую ошибку.

### 2.1. Причина №1 (главная): `spawn-helper` без флага исполнения

Начиная с node-pty 1.1.0 на macOS рабочий процесс запускается не через
`forkpty()`, а через внешний бинарник `spawn-helper` (схема `posix_spawn` +
helper). В npm-посылке (и в Homebrew-пакете) этот файл распаковывается с
правами `0644` — npm срезает exec-бит у всего, что не объявлено в `bin`.
Проверено напрямую:

```
$ node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper /tmp /bin/echo test
exit=126
/bin/bash: …/spawn-helper: Permission denied
```

Далее `posix_spawn()` возвращает `EACCES`, а node-pty печатает зашитую строку
`"posix_spawnp failed."` — без причины и без errno.

### 2.2. Причина №2: `helperPath` указывал внутрь asar-архива

`lib/unixTerminal.js` (node-pty) вычисляет путь к helper так:

```js
helperPath = helperPath.replace("app.asar", "app.asar.unpacked");
```

В упакованном приложении архив называется `app-arm64.asar` (в
`electron-builder.json` стоит `mergeASARs: false`), поэтому подстрока
`app.asar` не находится, замена не срабатывает, и в `posix_spawn()` уходит путь
вида `…/Resources/app-arm64.asar/node_modules/node-pty/build/Release/spawn-helper`.
Asar — виртуальная ФС уровня Electron; системный `posix_spawn` её не видит →
`ENOENT`.

### 2.3. Причина №3: `spawn-helper` падал с SIGSEGV

Исходный `src/unix/spawn-helper.cc`:

```c
char *slave_path = ttyname(STDIN_FILENO);
close(open(slave_path, O_RDWR));   /* slave_path может быть NULL → SIGSEGV */
```

Если stdin не является pty, `ttyname()` возвращает `NULL`, а `open(NULL)` роняет
процесс. Подтверждено краш-репортом
`~/Library/Logs/DiagnosticReports/spawn-helper-2026-09-19-162800.ips`:

```
"exception": {"type":"EXC_BAD_ACCESS","signal":"SIGSEGV",
              "subtype":"KERN_INVALID_ADDRESS at 0x0000000000000000"}
"frames": [{"imageOffset":1484,"symbol":"main","symbolLocation":44}, …]
"procPath": "…/app-arm64.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper"
```

### 2.4. Причина №4: `errno` не доходил до вызывающего кода

В `src/unix/pty.cc`, функция `pty_posix_spawn()`: при любой ранней ошибке
(`posix_openpt`, `grantpt`/`unlockpt`, `ioctl(TIOCPTYGNAME)`, `open(slave)`,
`tcsetattr`) выполняется `return`, но `*err` не заполняется. Вызывающий код
инициализирует его как `int err = -1;`, поэтому любая из этих ошибок выводится
как `posix_spawnp failed.` — реальная причина полностью теряется.

### 2.5. Сопутствующие проблемы сборочного окружения

| Симптом                                                             | Причина                                                                                                                                             | Закрыто                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `gyp: buildcheck.gypi not found` на `cpu-features`, падала упаковка | её install-скрипт `node buildcheck.js > buildcheck.gypi && node-gyp rebuild` выполнялся частично (npm 12 запускал только `node-gyp rebuild`)        | генерация `buildcheck.gypi` в `scripts/patch-nan.cjs`                       |
| `ld: unknown architecture arm64e.x1-macos`                          | `xcrun --show-sdk-path` отдавал SDK macOS 27.0 из Command Line Tools, а clang брался из Xcode 26.6 — старый линкер не понимает новые `.tbd`         | `SDKROOT` на SDK из Xcode в `scripts/build-mac-local.cjs`                   |
| `npm ci` не выполнял install-скрипты                                | политика npm 12 `allowScripts` (7 пакетов: `node-pty`, `better-sqlite3`, `@serialport/bindings-cpp`, `cpu-features`, `esbuild`, `ssh2`, `fsevents`) | список разрешённых уже в `package.json` + патчи применяются явно при сборке |

Краш-репорт `spawn-helper` в `DiagnosticReports` возникал и при ручном запуске
бинарника с не-tty stdin — то есть причина №3 воспроизводится независимо от
Termix.

---

## 3. Что именно исправлено (по файлам)

Все правки — в клоне на Рабочем столе; upstream не затрагивался.

| Файл                             | Тип                | Что делает                                                                    |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `scripts/patch-node-pty.cjs`     | новый (288 строк)  | закрывает причины №1–№4 и отдаёт наружу функцию `chmodSpawnHelpers()`         |
| `scripts/build-mac-local.cjs`    | новый (131 строка) | сборка одной командой + подпись                                               |
| `packaging/build/after-pack.cjs` | изменён (+57)      | восстановление прав на helper внутри уже упакованного приложения (до подписи) |
| `scripts/patch-nan.cjs`          | изменён (+35)      | генерация `cpu-features/buildcheck.gypi`, если файла нет                      |
| `package.json`                   | изменён (+12)      | `patch-node-pty.cjs` добавлен в `postinstall`; новый скрипт `build:mac-local` |
| `README_LOCAL.md`                | новый              | этот документ                                                                 |

### 3.1. `scripts/patch-node-pty.cjs`

Написан в стиле существующих `patch-*.cjs` (идемпотентный `patchFile()`
с проверкой `source.includes(patched)`, логи с префиксом `[patch-node-pty]`).
Пять правок:

1. **`chmodSpawnHelpers(dir)`** — рекурсивно находит все файлы `spawn-helper`
   и ставит `0755`, если нет флага исполнения. Возвращает число исправленных
   файлов; используется и в `postinstall`, и в `after-pack.cjs`.
2. **`lib/unixTerminal.js`** — вместо наивного `.replace('app.asar', …)`:
   сегмент `.asar` переписывается регуляркой `\.asar(?=[/\\]|$)` (ловит и
   `app.asar`, и `app-arm64.asar`, и `node_modules.asar`) с проверкой
   `fs.existsSync`, плюс в рантайме `fs.chmodSync(helperPath, 0o755)` в
   `try/catch` — самовосстановление прав перед первым форком.
3. **`src/unixTerminal.ts`** — то же самое в исходнике TypeScript, чтобы
   `src` и `lib` не расходились.
4. **`src/unix/spawn-helper.cc`** — переписан целиком: проверка `argc < 3`
   (`_exit(2)`), `ttyname()` с проверкой на `NULL`, `chdir` с диагностикой
   в stderr, `execvp` с сообщением и кодом `127` вместо молчаливого `1`.
5. **`src/unix/pty.cc`** — во всех пяти ранних `return` внутри
   `pty_posix_spawn()` записывается `*err = errno != 0 ? errno : EIO`, а
   `throw` теперь содержит `strerror(err)`, код ошибки и путь к helper:

```cpp
throw Napi::Error::New(
    napiEnv,
    "posix_spawnp failed: " + std::string(strerror(err)) + " (errno " +
        std::to_string(err) + ", helper: " + helper_path + ")");
```

### 3.2. `packaging/build/after-pack.cjs`

Раньше функция выходила сразу, если сборка не `dir`-target, и только писала
маркер `.portable`. Теперь (как в upstream PR #1417, но с учётом переименованных
asar-архивов) она после упаковки проходит по всем `*.asar.unpacked` в
`Contents/Resources` и вызывает `chmodSpawnHelpers()` — то есть права на helper
гарантированно восстановлены до подписи приложения.

### 3.3. `scripts/build-mac-local.cjs` и npm-скрипты

Новый скрипт `npm run build:mac-local` делает всё по шагам:

1. определяет `SDKROOT` (SDK из Xcode, а не из Command Line Tools) и
   `DEVELOPER_DIR`;
2. прогоняет `patch-better-sqlite3.cjs`, `patch-nan.cjs`, `patch-node-pty.cjs`
   — на случай, если `postinstall` при `npm ci` был пропущен;
3. `npm run build` — Vite-фронтенд + `tsc` бэкенд в `dist/`;
4. `electron-rebuild -f -o better-sqlite3,@serialport/bindings-cpp,node-pty` —
   нативные модули под ABI Electron (здесь же компилируется пропатченный
   `spawn-helper` из исходников);
5. `npm run electron:patch-builder`;
6. `electron-builder --mac dir --arm64` → `release/mac-arm64/Termix.app`;
7. восстановление прав `0755` на `spawn-helper` внутри пакета;
8. ad-hoc подпись `codesign --force --deep --sign - --options runtime` с
   энтайтлментами `packaging/build/entitlements.mac.plist` и проверка
   `codesign --verify --deep`.

В `package.json` добавлена строка
`"build:mac-local": "node scripts/build-mac-local.cjs"`, а `postinstall` теперь
заканчивается на `… && node scripts/patch-node-pty.cjs && node scripts/patch-xterm-android-ime.cjs`.

---

## 4. Как пересобрать и установить

```bash
cd /Users/aleksandrhohon/Desktop/development_locall/termix

npm ci                    # только при первом запуске / после правки зависимостей
npm run build:mac-local   # сборка + подпись, ~1-2 минуты
open release/mac-arm64/Termix.app

# обновить установленную копию
osascript -e 'quit app "Termix"'
rm -rf /Applications/Termix.app
cp -R release/mac-arm64/Termix.app /Applications/
open -a Termix
```

Логи сборки удобно писать в файл: `npm run build:mac-local > /tmp/build.log 2>&1 &`.

Данные приложения (`~/Library/Application Support/termix`) при пересборке
не трогаются: хосты, ключи и настройки остаются на месте.

---

## 5. Как проверялось (evidence)

| Проверка                                                                           | Результат                                                                                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Права до фикса                                                                     | `node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` → `-rw-r--r--`, запуск `exit=126 Permission denied` |
| Права после фикса                                                                  | `-rwxr-xr-x`, запуск идёт (`exit=1` на неверном cwd — уже логика helper)                                        |
| GUI-репро на настоящем Electron (спавн `/bin/zsh -l` как в `local-terminal-start`) | `SPAWN_OK_ALIVE` с реальным приглашением zsh                                                                    |
| Принудительно вернул helper в `644`                                                | спавн всё равно прошёл, права самовосстановились в `rwxr-xr-x` (self-heal)                                      |
| Упакованное приложение                                                             | `PACKAGED_SPAWN_OK`                                                                                             |
| Приложение из `/Applications`                                                      | `INSTALLED_SPAWN_OK`                                                                                            |
| Пропатченный helper в пакете                                                       | в `build/Release/spawn-helper` присутствует строка `spawn-helper: usage: …`                                     |
| Подпись                                                                            | `codesign --verify --deep` → `valid on disk`, `Identifier=com.karmaa.termix`, `Signature=adhoc`                 |
| Краш-репорты                                                                       | новых `spawn-helper`/`Termix` в `~/Library/Logs/DiagnosticReports` не появилось                                 |

Тестовые скрипты, которыми это проверялось, лежат в `/tmp/ptygui/`:
`main.js` (GUI-репро), `packaged.js`, `installed.js`.

---

## 6. Кастомизация

| Что менять                                      | Где                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Название приложения, bundle id, иконки, targets | `electron-builder.json` (`productName`, `appId`, `icon`, `directories.output`) |
| Иконки                                          | `public/icon.*` (генерация: `node scripts/generate-icons.mjs`)                 |
| Интерфейс                                       | `src/ui/**` (React + Vite)                                                     |
| Бэкенд (API, работа с хостами, БД)              | `src/backend/**`                                                               |
| Electron-процесс, локальный терминал            | `electron/main.cjs`, `electron/local-shell.cjs`                                |
| Какой шелл запускать локально                   | переменная окружения `TERMIX_LOCAL_SHELL` (иначе `$SHELL`, иначе `/bin/zsh`)   |
| Раскладки/шрифты/тема                           | `src/ui/**`, `public/fonts/**`                                                 |

После правок — `npm run build:mac-local` и копирование в `/Applications`.

Важно: если поменять `appId`, изменится и путь данных приложения — старые
`~/Library/Application Support/termix` при этом останутся на диске (переименуются
в новую папку не автоматически, копировать руками).

## 7. Диагностика

Где смотреть:

| Что                                      | Путь                                                   |
| ---------------------------------------- | ------------------------------------------------------ |
| Лог приложения (backend, сессии, ошибки) | `~/Library/Application Support/termix/termix-main.log` |
| Краш-репорты macOS                       | `~/Library/Logs/DiagnosticReports/`                    |
| Лог сборки                               | тот файл, куда перенаправили вывод `build:mac-local`   |

Типовые ошибки и что они значат:

| Сообщение                                                                        | Значение                                                             | Действие                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| `posix_spawnp failed: Permission denied (errno 13, helper: …)`                   | helper снова без exec-бита (например, переустановили `node_modules`) | `node scripts/patch-node-pty.cjs`              |
| `posix_spawnp failed: No such file or directory (errno 2, helper: …/app.asar/…)` | путь к helper внутри asar-архива                                     | проверить, что `lib/unixTerminal.js` пропатчен |
| `spawn-helper: usage: spawn-helper <cwd> <file> [args...]`                       | неверные аргументы helper (не наш случай, но теперь не падает молча) | —                                              |
| `spawn-helper: chdir(…) failed: …`                                               | рабочая директория недоступна                                        | проверить `cwd`/права                          |
| `ld: unknown architecture arm64e.x1-macos`                                       | сборка не с Xcode-овским `SDKROOT`                                   | собирать через `npm run build:mac-local`       |
| `gyp: buildcheck.gypi not found`                                                 | у `cpu-features` нет сгенерированного gyp-включаемого файла          | `node scripts/patch-nan.cjs`                   |

Проверить helper вручную:

```bash
H=/Applications/Termix.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper
stat -f '%Sp %N' "$H"                 # ожидается -rwxr-xr-x
strings "$H" | grep 'spawn-helper: usage'   # есть → версия пропатчена
```

## 8. Обновление из upstream и откат патчей

```bash
cd /Users/aleksandrhohon/Desktop/development_locall/termix
git remote -v                # origin → Termix-SSH/Termix
git fetch origin
git merge origin/main        # или git rebase
npm ci && npm run build:mac-local
```

Конфликты возможны в `package.json` (строка `postinstall`) и
`packaging/build/after-pack.cjs`. Патчи node-pty отдельным файлом, поэтому
обновление `node-pty` их не ломает: `scripts/patch-node-pty.cjs` применяется
заново, если исходники снова «чистые».

Откатить локальные правки (собрать как upstream): `git checkout -- package.json
packaging/build/after-pack.cjs scripts/patch-nan.cjs && rm scripts/patch-node-pty.cjs
scripts/build-mac-local.cjs`.

## 9. Что осталось от brew и что можно убрать

| Остаток                                                                 | Можно удалять?                        |
| ----------------------------------------------------------------------- | ------------------------------------- |
| `~/Library/Caches/Homebrew/downloads/…--termix_macos_universal_dmg.dmg` | Да, это просто скачанный образ        |
| `release/` внутри клона (~1 ГБ)                                         | Да, пересоберётся заново              |
| `node_modules/` (~700 МБ)                                               | Да, восстановится через `npm ci`      |
| `~/Library/Application Support/termix`                                  | **Нет** — там хосты и ключи           |
| `~/Library/Logs/DiagnosticReports/spawn-helper-2026-09-19-162800.ips`   | Да, это старое падение (историческое) |

## 10. Ограничения

- Собрана и проверена только сборка `mac dir arm64`. Universal/dmg/mas/notarize
  и сборки под Windows/Linux не проверялись (в `electron-builder.json` таргеты
  `mas`/`dmg` остались как в upstream).
- Подпись — ad-hoc (`Signature=adhoc`, без Team ID). Локально и после
  копирования внутрь системы работает; для распространения на другие машины
  потребуется Developer ID и нотаризация (`APPLE_ID`, `APPLE_ID_PASSWORD`,
  `APPLE_TEAM_ID` — тогда `packaging/build/notarize.cjs` сработает сам).
- `notarize.cjs` в текущей конфигурации молча пропускает нотаризацию, если
  переменные `APPLE_*` не заданы.
- При любом `brew install --cask termix` вернётся «сломанная» сборка: наши
  патчи живут только в этом клоне.

---

## 11. Чужой проект: лицензия и как с ним работать

### 11.1. Лицензия

Upstream распространяется под **Apache License 2.0**, © 2025 Luke Gustafson
(файл `LICENSE` в корне). Что это значит практически:

| Можно                                            | Нельзя / нужно                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Свободно использовать, менять, собирать локально | Удалять/подменять `LICENSE` и `NOTICE`                                                                                                                                                     |
| Распространять свои сборки (в т.ч. форки)        | Распространять молча: по §4b изменённые файлы обязаны нести пометку об изменении — она добавлена в `scripts/patch-nan.cjs`, `packaging/build/after-pack.cjs`, `scripts/patch-node-pty.cjs` |
| Держать форк публично или приватно               | Использовать имя/логотип Termix как «свой» бренд (§6, товарные знаки не передаются) — при публикации лучше переименовать (`productName`, `appId`)                                          |
| Отправлять пул-реквесты                          | Требовать от авторов поддержки нашего форка                                                                                                                                                |

Для личного использования на своей машине никаких обязательств не возникает:
мы ничего не публикуем.

### 11.2. Как устроен git после настройки

```bash
upstream  https://github.com/Termix-SSH/Termix.git   # чужой репозиторий, только чтение
origin    https://github.com/ASXRND/Termix.git       # наш форк (публичный)
main                                         # зеркало upstream, коммитить сюда нельзя
local/macos-pty-fixes                        # наша ветка, привязана к origin/local/macos-pty-fixes
```

`origin` указывает на форк, `upstream` — на чужой репозиторий: случайный
`git push` может уйти только в свой форк.

Отправка правок в форк (креды берутся из macOS Keychain):

```bash
git push origin local/macos-pty-fixes     # или просто git push (ветка уже трекается)
```

Восстановление ветки из форка на другой машине:

```bash
git clone https://github.com/ASXRND/Termix.git termix
cd termix && git checkout local/macos-pty-fixes
npm ci && npm run build:mac-local
```

### 11.3. Рабочий цикл

```bash
cd /Users/aleksandrhohon/Desktop/development_locall/termix

# правки кода
git checkout local/macos-pty-fixes
# ... редактируем src/**, electron/**, scripts/** ...
npm run build:mac-local
git add -A && git commit -m "..."

# обновление из чужого репозитория
git fetch upstream
git checkout main && git merge --ff-only upstream/main
git checkout local/macos-pty-fixes && git rebase main
npm ci && npm run build:mac-local
```

Конфликты ожидаемы только в `package.json` (строка `postinstall`) и
`packaging/build/after-pack.cjs` — наши патчи вынесены в отдельный файл
`scripts/patch-node-pty.cjs`, поэтому обновления upstream их не затирают.

### 11.4. Варианты хранения правок

| Вариант                                           | Плюсы                                                            | Минусы                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Локальные коммиты в ветке `local/macos-pty-fixes` | ничего не публикуется, история есть, можно бэкапить `git bundle` | нет внешнего бэкапа                                        |
| **Форк `ASXRND/Termix` — используется сейчас**    | внешний бэкап, удобно обновлять, можно перевести в приватный     | публичный форк с именем Termix (бренд не наш, §6)          |
| Пул-реквест в upstream                            | патчи перестают быть «нашими»: автор чинит у себя                | ревью, сроки, часть правок дублирует уже открытый PR #1417 |

`git bundle` для локального бэкапа:

```bash
git bundle create ~/Desktop/termix-local-fixes.bundle main local/macos-pty-fixes
```

### 11.5. Когда можно отказаться от форка

Если upstream выпустит релиз, где `spawn-helper` исполняемый и путь к нему
резолвится корректно (PR #1417 влит и попал в релиз), можно вернуться на
`brew install --cask termix` — тогда наши патчи не нужны, а `/Applications`
можно заменить официальной сборкой.

Форк готов к пул-реквесту: GitHub отдаёт ссылку
`https://github.com/ASXRND/Termix/pull/new/local/macos-pty-fixes`, целевой
репозиторий — `Termix-SSH/Termix`.

---

## 12. История коммитов (ветка `local/macos-pty-fixes`)

| Коммит    | Сообщение                                                        | Содержимое                                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `554f7d1` | `fix(macos): make the local terminal work (posix_spawnp failed)` | 6 файлов, +947 строк: `scripts/patch-node-pty.cjs` (новый), `scripts/build-mac-local.cjs` (новый), `packaging/build/after-pack.cjs`, `scripts/patch-nan.cjs`, `package.json`, `README_LOCAL.md` (новый) |
| `8186ce6` | `docs: указать форк origin и команды push/восстановления`        | актуализация раздела 11                                                                                                                                                                                 |
| далее     | коммиты `docs:` — обновления этого файла                         | разделы 0, 12, 13 и правки по ходу работы                                                                                                                                                               |
| `9c04860` | `chore: sync Crowdin translations`                               | база: клон upstream, наши коммиты идут поверх него                                                                                                                                                      |

Полезные команды:

```bash
git --no-pager log --oneline --stat local/macos-pty-fixes   # что менялось
git show 554f7d1                                            # полный diff фикса
git --no-pager log --oneline --graph --all -10              # картина ветвей
```

---

## 13. Шпаргалка команд

```bash
# 1. запустить приложение
open -a Termix

# 2. собрать после правок кода и обновить установленную копию
cd /Users/aleksandrhohon/Desktop/development_locall/termix
npm run build:mac-local
osascript -e 'quit app "Termix"'
rm -rf /Applications/Termix.app && cp -R release/mac-arm64/Termix.app /Applications/
open -a Termix

# 3. зафиксировать правки и отправить в свой форк
git checkout local/macos-pty-fixes
git add -A && git commit -m "..." && git push

# 4. подтянуть изменения из чужого репозитория
git fetch upstream
git checkout main && git merge --ff-only upstream/main
git checkout local/macos-pty-fixes && git rebase main
npm ci && npm run build:mac-local

# 5. проверить состояние
git remote -v && git branch -vv && git status --short
stat -f '%Sp' /Applications/Termix.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper
codesign --verify --deep /Applications/Termix.app && echo "подпись ок"
tail -20 "$HOME/Library/Application Support/termix/termix-main.log"

# 6. локальный бэкап ветки (страховка от потери диска)
git bundle create ~/Desktop/termix-local-fixes.bundle main local/macos-pty-fixes
```

---

## 14. Локальный проводник (Files, 19.09.2026)

Фича «проводник как в VS Code» для **локальной** машины: файловое дерево
домашней папки с предпросмотром файлов, живёт в **правом доке**. Док
рендерится вне split-контейнера, поэтому панель остаётся видимой при любой
нарезке терминальной области (2/3/6 панелей). При открытии вкладки локального
терминала док с файлами открывается сам (если пользователь его не закрыл и
не в мобильном режиме).

Как это работает:

| Слой             | Файл/точка                                            | Что делает                                                                                             |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| IPC main         | `electron/local-fs.cjs` (новый) + хук в `main.cjs`    | `local-fs:list/read/open`: readdir + превью (текст ≤512 КБ, картинки в base64), guard от `../`-обхода |
| preload          | `electron/preload.js` → `electronAPI.localFs`         | whitelisted-каналы для рендерера                                                                      |
| API-клиент       | `src/ui/features/local-explorer/localFsApi.ts`        | degrade в браузерной сборке (`localFsAvailable()`)                                                     |
| дерево           | `localFsTree.ts` (чистые функции) + `LocalFileTree.tsx`| ленивые дети, только папки раскрываются                                                                |
| панель           | `LocalFileExplorer.tsx` + `LocalFilePreview.tsx`      | дерево + превью (текст/картинка/бинарник → «открыть внешне»)                                           |
| правый док       | `rail-items.ts`: id `local-explorer`, `rightDockable` | иконка FolderTree, electronOnly; кейс в `AppShell.tsx` (renderSidebarPanels)                            |
| автопоказ        | `AppShell.tsx`, useEffect по `activeTabType`          | `setRightRailView(current ?? "local-explorer")` при вкладке `local-terminal`                           |
| типы             | `ui-types.ts` (`LocalFsEntry`, `LocalFsReadResult`), `ui-preferences.ts` (`HideableRailView`), `electron.d.ts` (`localFs`) |   |
| i18n             | `en.json` / `translated/ru_RU.json`: `nav.localExplorer`, блок `localExplorer`                        | en/ru синхронизированы (край файла)                                                                     |
| тесты            | `src/ui/tests/features/local-explorer.test.ts`, обновлён `rail-items.test.ts`                         | дерево (toRel/parentOfHome/sort), ключи локалей, списки рейла                                           |

Корень дерева — `$HOME` (переопределено 19.09.2026 по замечанию: раньше
открывался `dirname($HOME)`, из-за чего казалось, что панель стартует «в корне
устройства»). Если локальный терминал уже сообщил свой каталог, панель
открывается сразу в нём. Скрыты: `.DS_Store`, `Library`, `proc`, `sys`, `dev`,
`run`, `Volumes`, `mnt`, `boot`, `cdrom`, `lost+found`; лимит 500 записей на
папку, папки раньше файлов.

### 14.1 Следование за терминалом (OSC 7) и ручной путь

| Слой                | Файл/точка                                          | Что делает                                                                                          |
| ------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| инъекция шелла      | `electron/shell-integration.cjs` (новый)            | zsh → `ZDOTDIR` с `.zshenv/.zprofile/.zlogin/.zshrc`, bash → `--rcfile`; в конец добавляется хук cwd |
| детектор            | `electron/cwd-osc7.cjs` (новый)                     | потоковый парсер `ESC ] 7 ; file://HOST/PATH` (BEL или ST), переживает любую нарезку чанков         |
| проводка            | `main.cjs` (`local-terminal-start`)                 | каждый чанк идёт в детектор → `local-terminal:cwd:<sessionId>` в рендерер                            |
| preload/типы        | `preload.js` → `onLocalTerminalCwd`, `electron.d.ts` | подписка на cwd, отписка возвращается                                                                |
| публикация          | `LocalTerminal.tsx`                                 | `reportLocalCwd(dir)` при каждом `cd`                                                                |
| стор                | `local-explorer/localCwdStore.ts` (новый)           | pub/sub без проп-дриллинга: терминал публикует, проводник подписан                                  |
| проводник           | `LocalFileExplorer.tsx`                             | кнопка-«звено» (вкл/выкл слежение), путь-инпут + Enter, откат к ближайшему читаемому родителю         |

Механика: шелл сам печатает `OSC 7` в приглашении (`precmd` в zsh,
`PROMPT_COMMAND` в bash) — это тот же протокол, что используют VS Code и
iTerm2. Хук **дописывается** к rc-файлам пользователя через отдельный rc
(свои dotfiles не трогаем): zsh читает наши файлы из `ZDOTDIR`, каждый из них
сначала сорсит `$HOME/...`, bash получает `--rcfile`, который сорсит
`.bash_profile` → `.profile` → `.bashrc`. Windows PowerShell и прочие шеллы
(`fish`) не инструментируются — фича просто не активна, терминал работает как
раньше.

Поведение:
- слежение включено по умолчанию; `cd` в терминале → дерево переезжает;
- если каталог удалён/недоступен — откат к ближайшему листаемому родителю
  (`ancestorsOf` + `firstListable`), панель не остаётся пустой;
- ручной ввод пути или кнопка «домой» **выключают** слежение (терминал больше
  не дёргает дерево), вернуть — кликом по «звену»;
- не-абсолютный путь → красная подсказка `invalidPath`.

Проверено на этой машине: `node --check` × 5, `vitest run` — 2659 passed /
1 skipped (345 файлов), `eslint` — 0 проблем, `tsc -b --force` — 0 ошибок,
живой e2e `node-pty` + zsh − `cd /tmp` → детектор увидел
`["/Users/aleksandrhohon", "/Users/aleksandrhohon", "/tmp"]`.

Откат фичи целиком: `git checkout main -- electron/ src/ui/sidebar/ src/ui/AppShell.tsx src/types/ src/ui/locales/ && rm -rf src/ui/features/local-explorer src/ui/tests/features/local-explorer.test.ts src/ui/tests/electron/cwd-osc7.test.ts src/ui/tests/electron/shell-integration.test.ts` (коммит: `90ee5d8`, коммит со следованием — см. раздел 12).
