# Солнечный калькулятор Delta 500

Тестовый калькулятор выработки электроэнергии и экономии для солнечных панелей Delta 500 Вт. Паспорт модуля находится в `panel.pdf`. Статический сайт запускается из корня проекта командой `python3 -m http.server 8080`.

| Данные | Источник |
| --- | --- |
| Поиск адреса | [Photon](https://photon.komoot.io/), `GET https://photon.komoot.io/api/?q=…&countrycode=RU&limit=5&lang=ru`. Запрос отправляется по кнопке. Точность зависит от покрытия OpenStreetMap. Для публичной версии можно выбрать собственный Photon или договорной геокодер с адресами по России. |
| Карта | [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/), `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. [Leaflet](https://leafletjs.com/) рисует карту и перемещаемую метку. Спутниковое изображение открывается в Яндекс Картах по ссылке с координатами. |
| Солнечное излучение | [NASA POWER Climatology API](https://power.larc.nasa.gov/docs/services/api/temporal/climatology/), `GET https://power.larc.nasa.gov/api/temporal/climatology/point`, `community=RE`, `parameters=ALLSKY_SFC_SW_DWN`, `latitude`, `longitude`, `format=JSON`. Для внешнего запроса используются координаты центра ячейки сетки 1°. |
| Автоматический анализ крыши | [Google Solar API Building Insights](https://developers.google.com/maps/documentation/solar/building-insights) может дать характеристики крыши при подтверждённом [покрытии](https://developers.google.com/maps/documentation/solar/coverage) и доступе к API. Дополнительный сервис для отдельного этапа проекта. |

## Архив солнечных данных

`data/nasa-power-climatology.json` содержит 2 679 ячеек в пределах 41–60° с. ш. и 19–160° в. д. Данные извлечены из [помесячной выгрузки NASA POWER](https://github.com/hssaleh/Heat-Route-to-Firm-H2/blob/2cacb152e327a3246be186a40f83c2bcf6bc75e7/data/nasa_param_GHI.csv) с сохранением исходных значений по месяцам. Единицы измерения — кВт·ч/м² за средние сутки месяца. Значения за пределами сетки запрашиваются через API. Первоисточник — NASA Langley Research Center POWER Project. [Условия использования данных](https://registry.opendata.aws/nasa-power/).

## Как считается результат

Мощность станции равна количеству модулей, умноженному на 0,5 кВт. Для выработки берутся инсоляция местности, наклон, азимут и потери системы 20%. Экономия учитывает долю собственного потребления 60% и ограничивается средним месячным потреблением по счёту. Цена установки нужна для расчёта простой окупаемости. Затенение и выработка тыльной стороны потребуют проверки на объекте.

## Проверка

Расчёт для Ростова и Москвы проверен в Chromium на встроенных архивных данных. Разбор ответов Photon и NASA и восстановление при недоступности карты проверены на подменённых ответах. Прямые запросы из рабочей среды к Photon, плиткам OpenStreetMap и NASA POWER остановил сетевой фильтр до обращения к сервисам.

## Публикация на GitHub Pages

Загрузите содержимое архива в корень отдельного репозитория. В Settings → Pages выберите Deploy from a branch, ветку main и папку / (root). Для этой сборки достаточно статического хостинга.
