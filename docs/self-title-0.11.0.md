# Название первым действием, 0.11.0

## Причина

Установленный плагин 0.10.4 находился в
`/Users/agmazin/Library/Developer/paseo-releases/paseo-dialogs`.
Его server/runtime.ts совпадал с main репозитория после fcfe410.
`/Users/agmazin/Library/Developer/paseo-dialogs` - старая копия 0.0.0 без git,
она не является установленным runtime.

0.10.4 начинал именование только после agent.turn_ended с completed,
читал ключ CLIProxy и вызывал отдельный ai-fast. При ошибке или недоступной модели
название могло отсутствовать; даже успешное именование происходило после основной работы.
Повторные попытки 0.10.4 исправляли сбои запроса, но не момент именования и зависимость от внешней модели.

Фактический основной демон: PID 2375, worker 2377, 127.0.0.1:6767, версия в памяти 0.13.2.
CLI и новые plugin subprocess используют обновлённое приложение 0.14.0.
В нём schema agent.session_open уже требует title, labels, tools и mcpServers.
Старый демон этих полей не передаёт. Регистрация такого hook приводит к ошибке валидации
до callback, включая callback без возвращаемого значения. Перезапуск демона не выполнялся.

## Изменение

agent.create дописывает один помеченный блок к существующему systemPrompt,
сохраняет остальные MCP-серверы и toolPolicy, добавляет отдельный stdio-сервер dialogs_title.
У каждой конфигурации случайная capability, доступная процессу инструмента, но не аргументам модели.
MCP-инструмент name_this_chat принимает только title. Повторное применение блока идемпотентно;
совпадение имени существующего MCP-сервера завершает создание ошибкой вместо перезаписи.
Внутренние системные агенты не меняются.

agent.created связывает capability с конкретным зарегистрированным ID. Адаптер читает только
`<фактический PASEO_HOME>/agents/<cwd-slug>/<зарегистрированный id>.json`, проверяет id, cwd,
пометку инструкции и совпадение с выданной при create capability. Перечисления личных конфигураций нет.
Неизвестная схема или отсутствие файла не разрешают переименование. Вызов до agent.created
возвращает binding_pending; агент повторяет вызов. Pending capability и binding сохраняются на диске.
agent.session_open не используется. Сохранённые systemPrompt и MCP-конфигурация автоматически
возвращаются при возобновлении провайдерной сессии.

RPC выбирает ID по capability, а не по переданному моделью agentId. Дополнительные поля запрещены
в MCP и RPC. При неверной capability запрос отклоняется. Это ограничение конкретного инструмента,
оно не является изоляцией процессов одного пользователя macOS друг от друга.

Обработчик последовательно проверяет первое сообщение, исходное и актуальное имя, архив,
головной статус и пространство. Ручное имя сохраняется. При присвоении номера Канбана берётся
последний номер из меток или текущего префикса. Перед записью выполняется повторный refresh,
после записи проверяется фактическое название. Применённое имя сохраняется до update,
завершение - после проверки. Поэтому потеря ответа или записи завершения не вызывает второй rename.
После завершения любая новая тема в том же чате оставляет название прежним.

Запись использует уже существующий private adapter transferClient и только updateAgent metadata.
В 0.13.2 цепочка updateAgentCommand -> updateAgentMetadata -> setTitle/writeStoredMetadata
не содержит resume, import или unarchive и сохраняет archivedAt. Обновления метаданных
сериализуются daemon lifecycle mutation lane. Старый путь turn_ended/CLIProxy удалён полностью;
сохранённые старые candidates больше не запускаются. Непрочитанные маркеры не менялись.

## Проверки

`npm run typecheck`, `npm test`, `git diff --check`: 45 тестов, 0 ошибок.

Регрессии вызывают настоящие обработчики create/created/RPC с контролируемым metadata adapter:
сохранение systemPrompt/MCP/toolPolicy, повторная регистрация инструкции, параллельные вызовы,
ручное имя до вызова и во время подключения, новый номер Канбана, архив до и во время записи,
подагент, неверная capability, посторонний agentId, неверное название, временный сбой update,
потеря записи завершения, MCP до created, reload между create/created и после успешной записи.
Первое сообщение отдельно проверяется с пагинацией и отказом на неправильных cursor.

Живой прогон: tests/integration/self-title.mts, только disposable cwd
`/private/tmp/paseo-self-title-agm24-fixture` и временный runtime
`paseo-dialogs-self-title-fixture`. Fixture entry регистрирует только именование и пропускает
любые create с другим cwd. Личные чаты и вкладки не открываются и не изменяются.
В finally временный runtime удаляется, fixture-агенты и пространство архивируются.

Основной daemon 0.13.2, Codex gpt-6.1-sol:

- edd52525-2439-4411-b5f7-6fb72ad8ffbd, auto-review: DIA-1: Полив цветов.
- d94af6ee-1d02-41dd-bd63-4c0a46b1935d: DIA-2: Ручное имя, сохранено.
- 81095094-1bec-4e33-99e3-d884815adf09: DIA-3: Полив цветов, номер сохранён.
- c80cdafa-d5e8-4b3b-86c1-68d0122c4e16: DIA-4: Полив цветов после reload плагина до первого сообщения.

Во всех первых ходах: user_message -> dialogs_title.name_this_chat completed -> assistant_message.
В auto-review не потребовалось отдельного разрешения инструмента. После provider reload
и второго сообщения про суп название осталось прежним. Состояние предыдущих binding после
plugin reload и нового SDK-подключения совпало. Параллельные archive/updateAgent сохранили archivedAt,
следующий повтор инструмента не разархивировал чат; RPC с чужим agentId отклонён.

Доказательства, исключённые из git:
`/Users/agmazin/Yandex.Disk.localized/public/projects/local/paseo-dialogs/.qa/self-title-live/result.json`
и plain-timeline.json, manual-timeline.json, numbered-timeline.json, reconnect-timeline.json рядом.
Capability в отчёт и timeline аргументов не выводится. Client ID MCP-соединения случайный и не содержит capability.

## Границы API

SystemPrompt задаёт обязательное первое действие; наблюдаемое выполнение подтверждено реальными
timeline. Плагин 0.13.2 не может принудительно запретить модели все остальные инструменты
до именования. Враждебное игнорирование инструкции моделью не выдаётся за аппаратную гарантию.

В API updateAgent 0.13.2 нет compare-and-set по исходному имени. Повторный refresh защищает
изменения, видимые перед записью; ручной rename строго между последним refresh и update
нельзя атомарно защитить одним плагином. Для устранения этого узкого окна нужен условный
metadata update внутри демона. Архивирование проверено отдельно и не использует unarchive.

Пустую Codex-сессию нельзя provider reload до первого сообщения: провайдер сообщает
no rollout found. Поэтому проверены plugin reload до первого сообщения и provider reload
после первого завершённого хода. Это не ошибка именования.

## Приёмка и выкладка техлидом

Исполнитель не менял установленный production runtime. Техлид после проверки PR выполняет:

```sh
cd /Users/agmazin/Yandex.Disk.localized/public/projects/local/paseo-dialogs
npm run typecheck
npm test
git diff --check
PASEO_TEST_HOME=/Users/agmazin/.paseo node --experimental-strip-types tests/integration/self-title.mts
```

После merge и тега v0.11.0:

```sh
git -C /Users/agmazin/Library/Developer/paseo-releases/paseo-dialogs fetch origin --tags
git -C /Users/agmazin/Library/Developer/paseo-releases/paseo-dialogs checkout --detach v0.11.0
npm --prefix /Users/agmazin/Library/Developer/paseo-releases/paseo-dialogs ci
npm --prefix /Users/agmazin/Library/Developer/paseo-releases/paseo-dialogs run typecheck
paseo plugin reload paseo-dialogs
paseo plugin ls --json
```

Требуется running без ошибки. Проверить установленный production plugin только на disposable fixtures:

```sh
PASEO_TEST_HOME=/Users/agmazin/.paseo PASEO_TEST_PRODUCTION=1 node --experimental-strip-types tests/integration/self-title.mts
```

Этот режим не ставит и не снимает временный plugin, проверяет установленную версию 0.11.0,
читает binding только собственных fixture ID при сравнении и выполняет штатный reload production plugin.
Не перезапускать демон и не менять paseo-tabs/app-dist. Существующие агенты сохранённую новую
инструкцию не получают автоматически; архивы не открываются и не возобновляются.
Откат: checkout прежнего тега v0.10.4 в installed clone, npm ci, plugin reload.
