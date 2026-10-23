# Vrata BB

Desktop-сборка BB со встроенным провайдером Врата AI. При первом запуске пользователь вводит ключ, приложение проверяет его, сохраняет на локальной машине и выбирает Врата AI провайдером по умолчанию. Pi входит в сборку. Отдельно устанавливать плагин или агентский CLI не нужно. Для shell-инструментов на Windows нужен Git for Windows, как и для shell-скриптов обычного BB.

Версии BB и плагина заданы в `distribution.json`: `upstream.version` и `plugin.version`. Плагин скачивается из публичного npm как `@vrata-ai/bb-plugin@0.1.1`; `plugin.integrity` фиксирует SHA-512 опубликованного tarball. Версия Vrata BB всегда равна версии BB: например, BB 0.46.1 → Vrata BB 0.46.1. Единственный источник номера — `upstream.version`; отдельного счётчика нет. Исходники BB остаются без изменений в Git; `prepare.mjs` применяет проверяемые преобразования только в рабочем каталоге сборки. Не применяйте его в checkout с незакоммиченными изменениями BB.

## Сборка

Нужны Node.js 22.19.0, pnpm 9.15.0 и Git. Работайте в отдельном checkout.

```sh
node --test vrata/*.test.mjs
node vrata/prepare.mjs
pnpm install --frozen-lockfile --ignore-scripts --filter @bb/desktop... --filter @bb/app... --filter @bb/server... --filter @bb/host-daemon... --filter @bb/cli... --filter @bb/bundled-plugins...
pnpm exec turbo run typecheck --filter=@bb/app --filter=@bb/desktop --filter=@bb/server --filter=@vrata-ai/bb-plugin
pnpm exec turbo run test --filter=@bb/app -- VrataOnboardingGate
pnpm exec turbo run test --filter=@bb/server -- CatalogOnboarding provider-model-catalog-store general-settings
pnpm exec turbo run test --filter=@bb/desktop -- VrataDistribution
pnpm exec turbo run test --filter=@vrata-ai/bb-plugin
pnpm exec turbo run desktop:build:linux --filter=@bb/desktop
pnpm --dir apps/desktop run desktop:version-feed
```

На macOS используйте `desktop:build`, на Windows — `desktop:build:win`. Артефакты появляются в `apps/desktop/release/`. Поддерживаются macOS arm64, Windows x64 и Linux x64, как в закреплённом upstream. На Linux проверка упакованного приложения: `xvfb-run -a pnpm exec turbo run smoke:packaged --filter=@bb/desktop`.

`prepare.mjs` скачивает npm tarball, проверяет SHA-512, имя, версию и метаданные бандлов, затем применяет преобразования и `pnpm-lock.patch`. Доступ к репозиторию плагина и CI secrets не нужны. Исходники скачанного пакета попадают только во временный каталог сборки.

`prepare-plugin.mjs` использует сборщик текущего BB для server/app и сохраняет опубликованный host-бандл с Pi и его метаданные без изменений. React, TypeScript и их типы для сборки берутся из devDependencies SDK текущего BB; добавление плагина не обновляет зависимости остальных workspace-пакетов. npm-пакет не содержит исходные build assets Pi, поэтому host не пересобирается. При несовместимом SDK major сборка останавливается. Typecheck проверяет server/app и их зависимости; host проверяется через текущий SDK в runtime-тестах: сохранение и отклонение ключа, удаление credentials, выполнение хода Pi с записью файла. Проверка Pi использует один host-бандл вне checkout, без установленного Pi. Все запросы тестов идут в loopback API, платных вызовов нет. Полный набор unit-тестов плагина остаётся в его репозитории и не скачивается сборкой BB.

## Выпуски и обновления

Workflow **Vrata Desktop** собирает все три платформы. По умолчанию он сохраняет установщики только в артефактах Actions. Для публикации после merge в `main` запустите его с `publish=true`.

Публикация требует полный набор macOS secrets: `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID`. Для подписанного Windows-установщика задайте `WINDOWS_CERTIFICATE_PFX` и `WINDOWS_CERTIFICATE_PASSWORD`; без них Windows может показывать SmartScreen. Сертификаты и пароли хранятся в GitHub Actions secrets.

Установщики публикуются под неизменяемым тегом `vrata-v<VERSION>`. Только после проверки всех размеров и SHA-512 обновляются JSON/YAML feeds в `desktop-latest`. Они ссылаются на файлы конкретной версии, поэтому обновление feed не может перенаправить старый download на перезаписанный файл. При ошибке публикации установщиков канал не обновляется. Если публикация остановилась после создания version release, восстановите этот выпуск вручную или выпустите следующую версию BB; повторное использование version tag намеренно запрещено. На одну версию BB приходится один опубликованный выпуск Vrata; до публикации сборку можно повторять.

И проверка версии, и `electron-updater` используют `https://github.com/vrata-tg/vrata-bb/releases/download/desktop-latest/`. Пока репозиторий закрыт, эти адреса недоступны обычным пользователям. Публичность меняется отдельно; токен GitHub в приложение не встраивается. Nightly тоже направлен на наш репозиторий, но его публикация пока не настроена.

Название приложения — `Vrata BB`, app ID — `tg.vrata.bb`, данные — `~/.vrata-bb`, порты — 38986/38987. Это позволяет запускать его рядом с обычным BB. CLI, установленный самой сборкой в каталоге данных, использует ту же локальную конфигурацию.

## Новая версия BB

Workflow **Vrata Upstream** проверяет стабильные релизы каждые шесть часов, объединяет новый тег с нашим кодом, принимает его номер версии и выбирает опубликованную версию плагина из npm `latest`, затем проверяет преобразования и пересобирает lockfile. Номер выбранной версии и SHA-512 tarball записываются в PR; все платформы собираются с этой версией. Затем создаёт draft PR и запускает **Vrata Desktop** для его ветки. Merge и публикация остаются отдельными действиями. При конфликте или изменении точки интеграции workflow завершается с ошибкой, сохраняя текущий канал обновлений.

Для создания PR из Actions в настройках репозитория требуется **Allow GitHub Actions to create and approve pull requests**. Наш workflow создаёт PR, но не одобряет и не сливает их. Upstream workflows BB используют инфраструктуру и секреты проекта BB; оставляйте их выключенными в этом форке, запускайте `vrata-*.yml`.

Если политика организации запрещает создание PR, ветка обновления и запуск сборки всё равно создаются; workflow сообщает ссылку для ручного открытия PR. Для автоматического создания PR нужно изменить разрешение организации, одного переключателя репозитория недостаточно.

Тот же процесс можно запустить вручную из чистого checkout с настроенными `gh` и Git:

```sh
node vrata/update-upstream.mjs desktop-v0.46.2
```

После изменения интеграции или версии плагина выполните `node vrata/prepare.mjs /path/to/clean-bb-checkout --refresh-lock`, затем закоммитьте новый `pnpm-lock.patch` вместе с исходным изменением. Сгенерированные файлы BB не коммитятся.

## Обновление плагина

Плагин разрабатывается отдельно в `vrata-tg/vrata-bb-plugin` и публикуется в npm как `@vrata-ai/bb-plugin`. При обновлении BB автоматика выбирает npm `latest` и записывает точную версию и integrity в `distribution.json`. Все платформы и повторные сборки одного PR используют этот пакет. Prerelease под `latest` останавливает обновление; beta-версии следует публиковать под отдельным npm dist-tag.

Для ручного обновления плагина на текущем BB получите выбранную версию и integrity:

```sh
npm view @vrata-ai/bb-plugin@latest version dist.integrity --json
```

Обновите `plugin.version` и `plugin.integrity` в `vrata/distribution.json`, затем пересоберите lock patch в отдельном чистом checkout:

```sh
node vrata/prepare.mjs /path/to/clean-bb-checkout --refresh-lock
```

Закоммитьте `distribution.json` и `pnpm-lock.patch`, затем запустите desktop CI. Версия плагина независима от версии BB. На один опубликованный номер BB приходится один выпуск Vrata BB: исправление только плагина после публикации попадёт в следующий выпуск BB. Пользователь получает плагин внутри установщика; запуск приложения не скачивает npm `latest`.

Внутренний ID пакета `@vrata-ai/bb-plugin` в BB — `bb-plugin`; ID провайдера — `vrata`. Онбординг и CLI используют ID плагина для RPC. Сохраняйте лицензии BB и notices встроенного Pi.

## Управление через CLI и SDK

Онбординг использует уже существующие RPC плагина: `getConfiguration`, `saveCredentials`, `deleteCredentials`, а также `sdk.system.updateGeneralSettings`. При первом сохранении `onboardingCompletedAt` сервер помечает каталог моделей устаревшим: следующий запрос запускает фоновое обновление, и модели для сохранённого ключа появляются без перезапуска приложения. Это действует одинаково для UI, SDK и CLI. Новых API в ядре BB нет. Для работы из CLI сборки:

```sh
bb plugin rpc list bb-plugin --json
bb plugin rpc inspect bb-plugin saveCredentials --json
bb plugin rpc call bb-plugin saveCredentials --input-file /private/path/credentials-input.json --json
bb settings general defaultProviderId vrata
bb settings replay-onboarding
```

Вход `saveCredentials`: `{ "target": { "kind": "host", "hostId": "..." }, "apiKey": "...", "baseUrl": "https://api.vrata.tg" }`. Передавайте ключ через временный файл с ограниченными правами, удаляйте после вызова; не помещайте его в историю команд или Git. Для внешнего CLI выбирайте эту сборку через `BB_SERVER_URL=http://127.0.0.1:38986`.

Ключ хранится только в `credentials.json` плагина на выбранной машине: `0600` на macOS/Linux, наследуемые права каталога данных пользователя на Windows. Настройки сервера содержат только выбор провайдера и отметку завершения онбординга. На другой машине ключ настраивается отдельно через существующие настройки плагина.
