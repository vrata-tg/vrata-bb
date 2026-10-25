# Vrata BB

Desktop-сборка BB со встроенным провайдером Врата AI. При первом запуске пользователь вводит ключ, приложение проверяет его, сохраняет на локальной машине и выбирает Врата AI провайдером по умолчанию. Pi входит в сборку. Отдельно устанавливать плагин или агентский CLI не нужно. Для shell-инструментов на Windows нужен Git for Windows, как и для shell-скриптов обычного BB.

Версии BB и плагина заданы в `distribution.json`: `upstream.version` и `plugin.version`. Плагин скачивается из публичного npm как `@vrata-ai/bb-plugin@0.1.7`; `plugin.integrity` фиксирует SHA-512 опубликованного tarball. Версия Vrata BB всегда равна версии BB: например, BB 0.46.1 → Vrata BB 0.46.1. Единственный источник номера — `upstream.version`; отдельного счётчика нет. Исходники BB остаются без изменений в Git; `prepare.mjs` применяет проверяемые преобразования только в рабочем каталоге сборки. Не применяйте его в checkout с незакоммиченными изменениями BB.

## Сборка

Нужны Node.js 22.19.0, pnpm 9.15.0 и Git. Работайте в отдельном checkout.

```sh
node --test vrata/*.test.mjs
node vrata/prepare.mjs
pnpm install --frozen-lockfile --ignore-scripts --filter @bb/desktop... --filter @bb/app... --filter @bb/server... --filter @bb/host-daemon... --filter @bb/cli... --filter @bb/bundled-plugins...
pnpm exec turbo run typecheck --filter=@bb/app --filter=@bb/desktop --filter=@bb/server --filter=@vrata-ai/bb-plugin
pnpm exec turbo run test --filter=@bb/app -- VrataOnboardingGate
pnpm exec turbo run test --filter=@bb/server -- CatalogOnboarding provider-model-catalog-store general-settings
pnpm exec turbo run test --filter=@bb/desktop -- VrataDistribution desktop-update-provider
pnpm exec turbo run test --filter=@vrata-ai/bb-plugin
pnpm exec turbo run desktop:build:linux --filter=@bb/desktop
pnpm --dir apps/desktop run desktop:version-feed
```

На macOS используйте `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec turbo run desktop:build --filter=@bb/desktop`, на Windows — `pnpm exec turbo run desktop:build:win --filter=@bb/desktop`. Локальное окружение сборки должно быть без переменных с сертификатами и учётными данными для подписи. Артефакты появляются в `apps/desktop/release/`. Поддерживаются macOS arm64, Windows x64 и Linux x64, как в закреплённом upstream. На Linux проверка упакованного приложения: `xvfb-run -a pnpm exec turbo run smoke:packaged --filter=@bb/desktop`.

`prepare.mjs` скачивает npm tarball, проверяет SHA-512, имя, версию и метаданные бандлов, затем применяет преобразования и `pnpm-lock.patch`. Доступ к репозиторию плагина и CI secrets не нужны. Исходники скачанного пакета попадают только во временный каталог сборки.

`prepare-plugin.mjs` использует сборщик текущего BB для server/app и сохраняет опубликованный host-бандл с Pi и его метаданные без изменений. `prepare.mjs` дополняет старую регистрацию иконки Vrata значением `providerKind: "agent"`, обязательным в текущем SDK. React, TypeScript и их типы для сборки берутся из devDependencies SDK текущего BB; добавление плагина не обновляет зависимости остальных workspace-пакетов. npm-пакет не содержит исходные build assets Pi, поэтому host не пересобирается. При несовместимом SDK major сборка останавливается. Typecheck проверяет server/app и их зависимости; host проверяется через текущий SDK в runtime-тестах: сохранение и отклонение ключа, удаление credentials, выполнение хода Pi с записью файла. Проверка Pi использует один host-бандл вне checkout, без установленного Pi. Все запросы тестов идут в loopback API, платных вызовов нет. Полный набор unit-тестов плагина остаётся в его репозитории и не скачивается сборкой BB.

## Выпуски и обновления

Workflow **Vrata Desktop** собирает все три платформы. По умолчанию он сохраняет установщики только в артефактах Actions. Для публикации после merge в `main` запустите его с `publish=true`.

Все платформы собираются и публикуются без подписи издателя; notarization macOS отключена. Workflow не использует signing secrets, платный Apple Developer Account и сертификат Windows не нужны. GitHub-токен для публикации предоставляет Actions автоматически.

Windows может показывать SmartScreen и неизвестного издателя. macOS Gatekeeper может блокировать первый запуск; после переноса приложения в Applications разрешите открытие через System Settings → Privacy & Security → Open Anyway. Автоматическая установка обновлений на macOS отключена, поскольку Squirrel требует подпись приложения. Проверка новых версий работает; новый `.dmg` скачивается вручную из [GitHub Releases](https://github.com/vrata-tg/vrata-bb/releases). Windows и Linux AppImage в доступном для записи каталоге сохраняют автоматические обновления.

Установщики и шесть JSON/YAML feeds прикрепляются к одному draft release после проверки всех размеров и SHA-512. Затем выпуск публикуется и помечается `Latest`. Это совместимо с обязательной [неизменяемостью релизов GitHub](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases): после публикации не добавляются и не перезаписываются файлы. Feeds ссылаются на установщики своего неизменяемого version tag. При ошибке загрузки draft остаётся неопубликованным, текущий `Latest` сохраняется; восстановите draft вручную перед публикацией.

Обычный тег — `vrata-v<VERSION>`. Для исправления уже опубликованной сборки увеличьте `releaseRevision`: значение `1` даёт тег `vrata-v<VERSION>-r1`, сохраняя версию приложения равной BB. Опубликованные теги не переиспользуются. Обновление upstream автоматически сбрасывает ревизию в `0`. Ревизии с одинаковой версией приложения устанавливаются вручную.

И проверка версии, и `electron-updater` используют `https://github.com/vrata-tg/vrata-bb/releases/latest/download/`. GitHub направляет этот адрес на файлы выпуска `Latest`; отдельный изменяемый релиз канала не нужен. Пока репозиторий закрыт, эти адреса недоступны обычным пользователям. Публичность меняется отдельно; токен GitHub в приложение не встраивается. Nightly тоже направлен на наш репозиторий, но его публикация пока не настроена.

Название приложения — `Vrata BB`, app ID — `tg.vrata.bb`, данные — `~/.vrata-bb`, порты — 38986/38987. Это позволяет запускать его рядом с обычным BB. CLI, установленный самой сборкой в каталоге данных, использует ту же локальную конфигурацию.

## Новая версия BB

Workflow **Vrata Upstream** проверяет стабильные релизы каждые шесть часов, объединяет новый тег с нашим кодом, принимает его номер версии и выбирает опубликованную версию плагина из npm `latest`, затем проверяет преобразования и пересобирает lockfile. Номер выбранной версии и SHA-512 tarball записываются в PR; все платформы собираются с этой версией. Затем создаёт draft PR и запускает **Vrata Desktop** для его ветки. Merge и публикация остаются отдельными действиями. При конфликте или изменении точки интеграции workflow завершается с ошибкой, сохраняя текущий канал обновлений.

Для автоматики создайте fine-grained personal access token с доступом только к `vrata-tg/vrata-bb`: **Contents**, **Actions** и **Pull requests** — Read and write, **Workflows** — Write. Сохраните его как Actions repository secret `UPSTREAM_UPDATE_TOKEN` в Settings → Secrets and variables → Actions. Токен должен быть одобрен организацией, если её политика требует одобрения; обновляйте secret до истечения срока токена. Workflow использует один токен для checkout/push, запуска сборки и создания PR. Без secret он останавливается до checkout с сообщением о настройке.

Встроенный `GITHUB_TOKEN` не подходит: upstream merge меняет `.github/workflows/`, а `contents: write` и `actions: write` не разрешают такому токену отправлять изменения workflow. Переключатель **Allow GitHub Actions to create and approve pull requests** этого ограничения не снимает. Наш workflow создаёт PR, но не одобряет и не сливает их. Personal access token может запускать workflows по событиям push и pull_request; upstream workflows BB используют инфраструктуру и секреты проекта BB, поэтому оставляйте их выключенными в этом форке и запускайте `vrata-*.yml`.

Если создание PR отклонено после успешного push, ветка обновления и запуск сборки всё равно создаются; workflow сообщает ссылку для ручного открытия PR. Проверьте права токена и политику организации.

Тот же процесс можно запустить вручную из чистого checkout с настроенными `gh` и Git:

```sh
node vrata/update-upstream.mjs desktop-v0.46.2
```

После изменения интеграции или версии плагина выполните `node vrata/prepare.mjs /path/to/clean-bb-checkout --refresh-lock`, затем закоммитьте новый `pnpm-lock.patch` вместе с исходным изменением. Сгенерированные файлы BB не коммитятся.

## Обновление плагина

Плагин разрабатывается отдельно в `vrata-tg/vrata-bb-plugin` и публикуется в npm как `@vrata-ai/bb-plugin`. Каждая проверка `Vrata Upstream` выбирает npm `latest`, даже если версия BB не изменилась. При новой версии плагина автоматика создаёт отдельный PR, записывает точную версию и integrity в `distribution.json`, увеличивает `releaseRevision` и пересобирает lock patch. При обновлении BB ревизия сбрасывается в `0`. Все платформы и повторные сборки одного PR используют один закреплённый пакет. Prerelease под `latest` останавливает обновление; beta-версии следует публиковать под отдельным npm dist-tag.

Для ручного обновления плагина на текущем BB получите выбранную версию и integrity:

```sh
npm view @vrata-ai/bb-plugin@latest version dist.integrity --json
```

Обновите `plugin.version` и `plugin.integrity` в `vrata/distribution.json`, увеличьте `releaseRevision`, затем пересоберите lock patch в отдельном чистом checkout:

```sh
node vrata/prepare.mjs /path/to/clean-bb-checkout --refresh-lock
```

Закоммитьте `distribution.json` и `pnpm-lock.patch`, затем запустите desktop CI. Версия плагина независима от версии BB; обновление плагина на текущем BB выпускается под новой `releaseRevision` и устанавливается вручную. Пользователь получает плагин внутри установщика; запуск приложения не скачивает npm `latest`.

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
