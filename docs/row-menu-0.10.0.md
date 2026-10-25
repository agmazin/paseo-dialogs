# Меню строки диалога 0.10.0

Источник нативного поведения: установленный Paseo 0.13,
index-f1a1407fb8de7ac3fefc1cc576f0e46f.js.
Модуль buildWorkspaceTabMenuEntries использует Copy, Pencil, RotateCw, X;
ID справа - первые 7 символов. buildProviderCommand хранит шаблоны codex resume,
claude --resume, hermes --resume, pi --session, omp --session, opencode --session.
Обработчик копирования берёт runtimeInfo.sessionId, затем persistence.sessionId.
Перезагрузка вызывает refreshAgent, затем читает timeline.

Буфер обмена использует публичный copyText из @getpaseo/plugin/client/react-native.
В SDK 0.12 нет setTitle/refreshAgent/importAgent для агентов: серверный RPC использует
существующий локальный адаптер transferClient с проверкой версии 0.12, ID и адреса демона.
Вызовы закрываются в finally. Ошибки показываются через родной toast.
Закрытие вкладки - отдельный клиентский адаптер: модуль Metro определяется по форме стора,
без фиксированного номера. Пункт скрыт при отсутствии стора либо вкладки.
Закрывается только агент выбранного хоста; hideAgent предшествует closeTab.

Проверки меток вызывают настоящую серверную функцию и transfer с подменённым клиентом:
одинаковая ISO-метка стоит на чате и потомках до archiveAgent; архивные и потомки
другого пространства не получают explicit-archive-at. Метка переноса ставится на всех
неархивных потомков, включая находящихся в другом пространстве.

Настольный сценарий запускает скрытое окно Electron 44.2 с оригинальным app-dist 0.13
и отдельным демоном 0.12 на 6796. Основные вкладки Александра не использует.
Результат - row-menu-verification.json, снимки - shots/0.10.0.
