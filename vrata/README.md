# Vrata BB

Desktop-сборка BB со встроенным провайдером Врата AI. При первом запуске пользователь вводит ключ, приложение проверяет его, сохраняет на локальной машине и выбирает Врата AI провайдером по умолчанию. Pi входит в сборку. Отдельно устанавливать плагин или агентский CLI не нужно. Для shell-инструментов на Windows нужен Git for Windows, как и для shell-скриптов обычного BB.

Версия BB закреплена в `distribution.json`, commit плагина — Git submodule `vrata/plugin`, который ссылается на `vrata-tg/vrata-bb-plugin`. Версия Vrata BB всегда равна версии BB: например, BB 0.46.1 → Vrata BB 0.46.1. Единственный источник номера — `upstream.version`; отдельного счётчика нет. Исходники BB остаются без изменений в Git; `prepare.mjs` применяет проверяемые преобразования только в рабочем каталоге сборки. Не применяйте его в checkout с незакоммиченными изменениями BB.

## Сборка

Нужны Node.js 22.19.0, pnpm 9.15.0 и Git. Работайте в отдельном checkout.

```sh
git submodule update --init -- vrata/plugin
node --test vrata/*.test.mjs
node vrata/prepare.mjs
pnpm install --frozen-lockfile --ignore-scripts --filter @bb/desktop... --filter @bb/app... --filter @bb/server... --filter @bb/host-daemon... --filter @bb/cli... --filter @bb/bundled-plugins...
pnpm exec turbo run typecheck --filter=@bb/app --filter=@bb/desktop --filter=bb-plugin-vrata
pnpm exec turbo run test --filter=@bb/app -- VrataOnboardingGate
pnpm exec turbo run test --filter=@bb/desktop -- VrataDistribution
pnpm exec turbo run test --filter=bb-plugin-vrata
pnpm exec turbo run desktop:build:linux --filter=@bb/desktop
pnpm --dir apps/desktop run desktop:version-feed
```

На macOS используйте `desktop:build`, на Windows — `desktop:build:win`. Артефакты появляются в `apps/desktop/release/`. Поддерживаются macOS arm64, Windows x64 и Linux x64, как в закреплённом upstream. На Linux проверка упакованного приложения: `xvfb-run -a pnpm exec turbo run smoke:packaged --filter=@bb/desktop`.

`prepare.mjs` проверяет, что submodule находится на закреплённом commit, экспортирует его исходники через Git, собирает Pi из его npm lockfile, подключает SDK из текущего BB и применяет `pnpm-lock.patch`. Локальные изменения, незакоммиченные файлы и Git credentials не копируются в сборку. Тесты плагина используют собранные bundles и отдельную npm-среду, чтобы зависимости тестов не смешивались с React приложения. Секреты для тестов не нужны; используется loopback API.

## Выпуски и обновления

Workflow **Vrata Desktop** собирает все три платформы. По умолчанию он сохраняет установщики только в артефактах Actions. Для публикации после merge в `main` запустите его с `publish=true`.

Публикация требует полный набор macOS secrets: `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID`. Для подписанного Windows-установщика задайте `WINDOWS_CERTIFICATE_PFX` и `WINDOWS_CERTIFICATE_PASSWORD`; без них Windows может показывать SmartScreen. Сертификаты и пароли хранятся в GitHub Actions secrets.

Установщики публикуются под неизменяемым тегом `vrata-v<VERSION>`. Только после проверки всех размеров и SHA-512 обновляются JSON/YAML feeds в `desktop-latest`. Они ссылаются на файлы конкретной версии, поэтому обновление feed не может перенаправить старый download на перезаписанный файл. При ошибке публикации установщиков канал не обновляется. Если публикация остановилась после создания version release, восстановите этот выпуск вручную или выпустите следующую версию BB; повторное использование version tag намеренно запрещено. На одну версию BB приходится один опубликованный выпуск Vrata; до публикации сборку можно повторять.

И проверка версии, и `electron-updater` используют `https://github.com/vrata-tg/vrata-bb/releases/download/desktop-latest/`. Пока репозиторий закрыт, эти адреса недоступны обычным пользователям. Публичность меняется отдельно; токен GitHub в приложение не встраивается. Nightly тоже направлен на наш репозиторий, но его публикация пока не настроена.

Название приложения — `Vrata BB`, app ID — `tg.vrata.bb`, данные — `~/.vrata-bb`, порты — 38986/38987. Это позволяет запускать его рядом с обычным BB. CLI, установленный самой сборкой в каталоге данных, использует ту же локальную конфигурацию.

## Новая версия BB

Workflow **Vrata Upstream** проверяет стабильные релизы каждые шесть часов, объединяет новый тег с нашим кодом, принимает его номер версии, проверяет преобразования и пересобирает lockfile. Затем создаёт draft PR и запускает **Vrata Desktop** для его ветки. Merge и публикация остаются отдельными действиями. При конфликте или изменении точки интеграции workflow завершается с ошибкой, сохраняя текущий канал обновлений.

Для создания PR из Actions в настройках репозитория требуется **Allow GitHub Actions to create and approve pull requests**. Наш workflow создаёт PR, но не одобряет и не сливает их. Upstream workflows BB используют инфраструктуру и секреты проекта BB; оставляйте их выключенными в этом форке, запускайте `vrata-*.yml`.

Если политика организации запрещает создание PR, ветка обновления и запуск сборки всё равно создаются; workflow сообщает ссылку для ручного открытия PR. Для автоматического создания PR нужно изменить разрешение организации, одного переключателя репозитория недостаточно.

Тот же процесс можно запустить вручную из чистого checkout с настроенными `gh` и Git:

```sh
node vrata/update-upstream.mjs desktop-v0.46.2
```

После изменения интеграции или закреплённого commit плагина выполните `node vrata/prepare.mjs /path/to/clean-bb-checkout --refresh-lock`, затем закоммитьте новый `pnpm-lock.patch` вместе с исходным изменением. Сгенерированные файлы BB не коммитятся.

## Обновление плагина

`vrata/plugin/` — Git submodule отдельного репозитория плагина. CI скачивает ровно закреплённый commit, поэтому повторная сборка BB не подхватит случайные изменения `main` плагина. Изменения плагина разрабатываются в `vrata-tg/vrata-bb-plugin`; в форке хранится только ссылка, без копии исходников.

Для обновления выберите проверенный commit плагина и измените ссылку:

```sh
git submodule update --init -- vrata/plugin
git -C vrata/plugin fetch origin COMMIT
git -C vrata/plugin checkout --detach COMMIT
git add vrata/plugin
node vrata/prepare.mjs /path/to/clean-bb-checkout --refresh-lock
```

`COMMIT` — полный SHA выбранной версии. `git add vrata/plugin` закрепляет его в индексе; preparation и release notes читают именно эту ссылку. Закоммитьте её вместе с обновлённым `vrata/pnpm-lock.patch`, затем запустите desktop CI. Сохраняйте лицензии BB и notices встроенного Pi.

Пока репозиторий плагина private, оба workflow используют Actions secret `VRATA_PLUGIN_DEPLOY_KEY`: приватную часть отдельного SSH deploy key, добавленного в репозиторий плагина **без write access**. Checkout удаляет Git credentials после загрузки; в приложение ключ не попадает. Для локальной сборки нужен свой доступ к репозиторию через Git. После открытия репозитория плагина secret можно удалить: checkout использует публичный HTTPS-доступ. Открытие только репозитория BB не делает исходники плагина доступными внешним сборщикам.

## Управление через CLI и SDK

Онбординг использует уже существующие RPC плагина: `getConfiguration`, `saveCredentials`, `deleteCredentials`, а также `sdk.system.updateGeneralSettings`. Новых API в ядре BB нет. Для работы из CLI сборки:

```sh
bb plugin rpc list vrata --json
bb plugin rpc inspect vrata saveCredentials --json
bb plugin rpc call vrata saveCredentials --input-file /private/path/credentials-input.json --json
bb settings general defaultProviderId vrata
bb settings replay-onboarding
```

Вход `saveCredentials`: `{ "target": { "kind": "host", "hostId": "..." }, "apiKey": "...", "baseUrl": "https://api.vrata.tg" }`. Передавайте ключ через временный файл с ограниченными правами, удаляйте после вызова; не помещайте его в историю команд или Git. Для внешнего CLI выбирайте эту сборку через `BB_SERVER_URL=http://127.0.0.1:38986`.

Ключ хранится только в `credentials.json` плагина на выбранной машине: `0600` на macOS/Linux, наследуемые права каталога данных пользователя на Windows. Настройки сервера содержат только выбор провайдера и отметку завершения онбординга. На другой машине ключ настраивается отдельно через существующие настройки плагина.
