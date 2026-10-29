# Архив и совместимость Paseo 0.13.2

Версия плагина: 0.10.3. Проверка: 29.10.2026.

## Причина и исправление

Действия меню использовали transferClient с точной проверкой status.version === "0.12.0".
После обновления desktop-managed демона до 0.13.2 проверка прерывала архивирование до изменений.

Чтение агентов, список потомков и archive() переведены на публичный PaseoApi хоста.
Публичный SDK 0.13.2 проверен по npm-пакету и официальной документации; updateAgent,
importAgent и refreshAgent там отсутствуют. Для меток явного архива, восстановления,
переименования и перезагрузки сохранён приватный адаптер SDK 0.12.0.
После повторения gate адаптер допускает ровно 0.12.0 и 0.13.2. Совпадение serverId,
локальный адрес, конфигурация собственного home и обязательные методы проверяются до мутаций.
Восстановление дополнительно проверяет сохранение ID и workspaceId.

## Изолированная проверка

Демон 0.13.2: 127.0.0.1:6793.
Home: /Users/agmazin/Library/Developer/paseo-dialogs/agm22-0132-home.
Пользовательские чаты основного home не архивировались и не переносились.

Проверены реальные Codex-сессии с завершёнными ходами и сохранённой историей:

- dialogs.action archive/restore: ID, workspace, имя, метки и текст истории сохранены.
- dialogs.move: тот же ID, одна запись сессии, имя и история сохранены.
- Живые потомки восстановлены; связь потомка из другого workspace восстановлена; ранее архивный потомок остался архивным.
- Настоящий отказ демона при импорте в отсутствующий workspace: transfer выполняет откат, возвращает исходное пространство, историю и потомков.
- Подмена только ответа getDaemonStatus на 0.13.3: проверка контракта отклоняет соединение до мутаций; состояние настоящего тестового агента не изменяется.
- Отдельные регрессии проверяют отсутствие методов, неверный serverId, пустой serverId и неподдерживаемые версии.

Результат последнего прогона:

```json
{
  "version": "0.13.2",
  "host": "127.0.0.1:6793",
  "agentId": "09acb56d-b124-4718-abb0-72e6a45bc39e",
  "archiveRestoreRpc": {
    "sameId": true,
    "title": true,
    "labels": true,
    "history": true,
    "nativeSdk": true
  },
  "moveRpc": {
    "sameId": true,
    "history": true,
    "title": true,
    "liveChildrenRestored": true,
    "crossWorkspaceParentRestored": true,
    "oldChildStillArchived": true
  },
  "rollback": {
    "realDaemonRejectsMissingWorkspace": true,
    "sourceRestored": true,
    "history": true,
    "children": true
  },
  "unsupportedVersion": {
    "rejectedBeforeMutation": true
  },
  "singleSessionRecord": true
}
```

Повторный прогон: tests/integration/archive-0132.mts.
Нужны PASEO_TEST_HOME, PASEO_TEST_FIXTURES (JSON с source.workspace.id и target.workspace.id),
PASEO_TEST_AGENT (JSON с id), необязательный PASEO_TEST_RESULT для JSON-отчёта.
Скрипт допускает только отдельный home с портом 6793 и проверяет serverId и метку agm22.fixture=true.
У тестового корневого агента должна быть завершённая сохранённая сессия; скрипт создаёт собственных тестовых потомков.

## Автоматическая проверка

npm run typecheck и npm test: 34 теста, 0 ошибок.
CI запускает npm ci, typecheck и все модульные тесты на push и pull_request.
Тяжёлые сырые логи и временные файлы находятся в игнорируемом каталоге .qa.

## Внедрение

Рабочий runtime загружается из /Users/agmazin/Library/Developer/paseo-releases/paseo-dialogs.
Выкладка: checkout v0.10.3 и paseo plugin reload paseo-dialogs без перезапуска демона.
Проверка рабочего RPC: запрос к отсутствующему тестовому ID должен пройти проверку совместимости
и вернуть "Диалог не найден"; рабочие агенты не изменяются. Успешные мутации проверены только на 6793.
