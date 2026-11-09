# Android: повторное открытие диалога

Проверено 09.11.2026 на релизном APK Paseo 0.14.0 в Android 11 ARM64 emulator (API 30), через relay.paseo.sh. Демон 0.14.0 запущен отдельно на 127.0.0.1:16839 с копией тестовых агентов и проектов. Боевой демон и его home не менялись.

## Причина

Destination вызывал навигацию синхронно из useLayoutEffect дочернего экрана. На native проверка isNavigationScreenActive сразу возвращала true, в отличие от web, где ожидала URL. Повторное открытие уже загруженного агента попадало в синхронный маршрут workspace: переход выполнялся до фиксации родительского стека нового plugin screen. В результате поверх диалога оставался пустой экран "Диалоги"; started.current запрещал следующую попытку.

Холодное открытие не воспроизводило ошибку: если агент ещё отсутствовал в session store, Paseo сначала открывал отдельный agent route, загружал его данные и затем переходил в workspace.

Исходники Paseo v0.14.0, commit `8c6de842a3157530c26a7a94c78a3d647fb96ce9`:

- `packages/app/src/plugins/sidebar-items/index.tsx`: openScreen вызывает router.push для plugin surface.
- `packages/app/src/plugins/host-navigation-model.ts`: navigation.openAgent передаёт вызов владельцу навигации.
- `packages/app/src/utils/navigate-to-agent/index.ts` и `resolve.ts`: наличие workspaceId в session store выбирает немедленный navigateToWorkspace; отсутствие ведёт на agent detail route.
- `packages/app/src/navigation/workspace-route-navigation.ts`: переход читает root navigation state и делает POP_TO либо router.dismissTo.
- `packages/app/src/app/h/[serverId]/agent/[agentId].tsx`: холодный маршрут получает данные и отдельно открывает агента.

## Исправление

Destination вынесен в отдельный клиентский модуль. Попытка запускается из useEffect через отменяемый macrotask после commit родительской навигации. Семантически одинаковые params и смена ссылок SDK/navigation не отменяют и не блокируют попытку. При смене запроса, уходе с экрана и таймауте поздние ответы не вызывают навигацию.

При наличии workspaceId остаётся refresh для актуальных данных после переноса/архива; лишний openWorkspace перед openAgent удалён. Обычное открытие существующего агента не ждёт refresh.

Экран показывает индикатор и текст загрузки. Ошибки имеют кнопку "Повторить". Если экран остаётся открытым, watchdog через 15 секунд показывает ошибку перехода; это также покрывает навигацию, которая ничего не сделала без исключения. Повтор отменяет действие старой попытки, но не откатывает уже выполненные операции на сервере. Для создания используются прежние token/claim и idempotencyKey.

## Проверка

- Исходная 0.11.3: первое открытие PAP-1 успешно, повторное открытие того же агента из бокового списка оставляет только Back и "Диалоги". Снимок baseline-reopen.png совпадает с описанием дефекта.
- Исправленная 0.11.4: пять последовательных повторных открытий в той же Android-сессии через relay завершились видимой историей и полем сообщения. Результаты сохранены в fixed-reopens.json, скриншот в fixed-reopen.png.
- Android error/retry: в отдельной временной копии плагина инъецирована однократная ошибка перехода. Сообщение и кнопка видны; нажатие "Повторить" открыло историю и поле сообщения. Скриншоты error.png и retry-success.png. Инъекция не входит в release.
- React component tests: отложенный старт после родителя, стабильность при rerender, ошибка refresh и успешный retry, timeout зависшего refresh, подавление позднего ответа после retry/unmount/смены запроса/ухода с web route, native archive fallback и отмена до запуска.
- Desktop web: отдельный Playwright chrome-headless-shell, 1440x1000, тестовый daemon. Три повторных открытия успешно перешли на workspace; снимок desktop.png. Личный Chrome не использовался.
- npm run typecheck: успешно. npm test: 76 тестов успешно.

Артефакты Android вне git: `/Users/agmazin/Library/Developer/paseo-dialogs/android-navigation-evidence`.
SDK, APK, AVD и исходники upstream находятся во временных каталогах `/tmp/paseo-android-sdk`, `/tmp/paseo-android-avd`, `/tmp/paseo-android-source`. Home тестового демона: `/tmp/paseo-android-home`.

Установка в боевой Paseo остаётся за техлидом. Тег v0.11.4 создаётся после merge PR.
