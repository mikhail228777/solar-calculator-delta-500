const homeFields = `
  <fieldset class="scenario-fields">
    <legend>Резерв при отключении</legend>
    <div class="input-grid">
      <div>
        <label for="battery">Полезная ёмкость аккумулятора</label>
        <div class="unit-input"><input id="battery" type="text" inputmode="decimal" maxlength="12" placeholder="Например, 10" aria-describedby="backup-help"><span>кВт·ч</span></div>
      </div>
      <div>
        <label for="backup-load">Средняя мощность нужных приборов</label>
        <div class="unit-input"><input id="backup-load" type="text" inputmode="decimal" maxlength="12" placeholder="Например, 500" aria-describedby="backup-help"><span>Вт</span></div>
      </div>
    </div>
    <p class="field-note" id="backup-help">Возьмите полезную ёмкость по паспорту АКБ и сложите среднюю мощность приборов. Для питания при отключении нужен инвертор с резервным выходом.</p>
    <details class="optional-fields">
      <summary>Заряд и мощность инвертора</summary>
      <div class="input-grid details-inputs">
        <div>
          <label for="charge">Заряд в начале отключения</label>
          <div class="unit-input"><input id="charge" type="text" inputmode="decimal" maxlength="8" value="100"><span>%</span></div>
        </div>
        <div>
          <label for="inverter">Мощность резервного выхода</label>
          <div class="unit-input"><input id="inverter" type="text" inputmode="decimal" maxlength="12" placeholder="3"><span>кВт</span></div>
        </div>
      </div>
    </details>
  </fieldset>

  <details class="station financial-fields" id="economics">
    <summary><span>Экономия и окупаемость</span><b>Необязательно</b></summary>
    <div class="input-grid details-inputs">
      <div>
        <label for="bill">Расходы на электроэнергию</label>
        <div class="unit-input"><input id="bill" type="text" inputmode="decimal" maxlength="16" placeholder="5 000" aria-describedby="economy-note"><span>₽/мес.</span></div>
      </div>
      <div>
        <label for="tariff">Тариф за энергию</label>
        <div class="unit-input"><input id="tariff" type="text" inputmode="decimal" maxlength="12" placeholder="6,00" aria-describedby="economy-note"><span>₽/кВт·ч</span></div>
      </div>
      <div>
        <label for="cost">Стоимость станции с монтажом</label>
        <div class="unit-input"><input id="cost" type="text" inputmode="decimal" maxlength="16" aria-describedby="economy-note"><span>₽</span></div>
      </div>
    </div>
    <p class="field-note" id="economy-note">Укажите расходы за кВт·ч без фиксированных платежей. В расчёте дом использует 60% выработки в пределах потребления. Для окупаемости укажите полную стоимость установки, включая батарею, если она входит в проект.</p>
  </details>`;

const industryFields = `
  <fieldset class="scenario-fields">
    <legend>Потребление и тариф</legend>
    <div class="input-grid">
      <div>
        <label for="consumption">Потребление за средний месяц</label>
        <div class="unit-input"><input id="consumption" type="text" inputmode="decimal" maxlength="16" placeholder="90 000" aria-describedby="economy-note"><span>кВт·ч</span></div>
      </div>
      <div>
        <label for="tariff">Тариф за энергию</label>
        <div class="unit-input"><input id="tariff" type="text" inputmode="decimal" maxlength="12" placeholder="9,50" aria-describedby="economy-note"><span>₽/кВт·ч</span></div>
      </div>
      <div>
        <label for="self-use">Доля выработки для своих нужд</label>
        <div class="unit-input"><input id="self-use" type="text" inputmode="decimal" maxlength="8" aria-describedby="economy-note"><span>%</span></div>
      </div>
    </div>
    <p class="field-note" id="economy-note">Возьмите кВт·ч и тариф за энергию из счёта. Долю выработки, которую предприятие потребит на месте, оцените по дневной нагрузке и графику работы.</p>
  </fieldset>

  <fieldset class="scenario-fields">
    <legend>Стоимость станции</legend>
    <div class="input-grid">
      <div>
        <label for="cost">Оборудование и монтаж</label>
        <div class="unit-input"><input id="cost" type="text" inputmode="decimal" maxlength="16" aria-describedby="cost-note"><span>₽</span></div>
      </div>
      <div>
        <label for="maintenance">Расходы на обслуживание</label>
        <div class="unit-input"><input id="maintenance" type="text" inputmode="decimal" maxlength="16" aria-describedby="cost-note"><span>₽/год</span></div>
      </div>
    </div>
    <p class="field-note" id="cost-note">Цена проекта нужна для расчёта окупаемости. Если оставить расходы пустыми, калькулятор примет их равными нулю.</p>
  </fieldset>`;

const generationMetric = `<div class="metric"><dt>Выработка за год</dt><dd id="generation"></dd></div>`;
const paybackMetric = `<div class="metric" id="payback-metric" hidden><dt>Простая окупаемость</dt><dd id="payback"></dd></div>`;

function resultMetrics(industry) {
  const saving = `<div class="metric" id="saving-metric" hidden><dt>${industry ? 'Чистая экономия за год' : 'Экономия за год'}</dt><dd id="saving"></dd></div>`;
  return industry
    ? `${saving}${paybackMetric}${generationMetric}`
    : `<div class="metric" id="backup-metric" hidden><dt>От аккумулятора без солнца</dt><dd id="backup-time"></dd></div>${generationMetric}${saving}${paybackMetric}`;
}

const dailyProduction = `
  <section class="production" aria-labelledby="solar-day-title">
    <div class="chart-heading">
      <h3 id="solar-day-title">Солнечная энергия за день</h3>
      <div class="month-field">
        <label for="backup-month">Месяц</label>
        <select id="backup-month">
          <option value="0">Январь</option><option value="1">Февраль</option><option value="2">Март</option>
          <option value="3">Апрель</option><option value="4">Май</option><option value="5">Июнь</option>
          <option value="6">Июль</option><option value="7">Август</option><option value="8">Сентябрь</option>
          <option value="9">Октябрь</option><option value="10">Ноябрь</option><option value="11">Декабрь</option>
        </select>
      </div>
    </div>
    <dl class="day-metrics" aria-live="polite">
      <div><dt>Средняя выработка панелей</dt><dd id="solar-daily-energy"></dd></div>
      <div id="daily-load-metric" hidden><dt>Нужные приборы за 24 ч</dt><dd id="daily-load"></dd></div>
    </dl>
    <p class="result-note">Панели могут питать приборы и заряжать батарею при отключении, если инвертор поддерживает работу от солнца без сети. Здесь показано среднее за выбранный месяц. Время работы при отключении зависит от погоды, времени суток и нагрузки.</p>
  </section>`;

export function mountCalculator(workspace, industry) {
  workspace.innerHTML = `
  <form class="calculator" id="calculator" aria-label="Параметры расчёта" novalidate>
    <div class="address-field">
      <label for="address">Адрес или город</label>
      <div class="address-input">
        <input id="address" type="search" maxlength="180" placeholder="Ростов-на-Дону, улица, дом" spellcheck="false" autocomplete="off" aria-describedby="address-status">
        <button type="button" class="quiet-button" id="find">Найти</button>
      </div>
      <ul class="address-results" id="address-results" aria-label="Найденные адреса" hidden></ul>
      <p class="field-note" id="address-status" role="status" hidden></p>
    </div>

    <div class="location-tools">
      <button type="button" id="map-toggle" class="text-button" aria-controls="map-panel" aria-expanded="false">Точка на карте <span aria-hidden="true">↓</span></button>
      <span id="point-description" hidden></span>
    </div>

    <section class="map-panel" id="map-panel" aria-label="Выбор местоположения" hidden>
      <div class="map-frame">
        <div class="map" id="map" aria-label="Интерактивная карта"></div>
        <div class="map-message" id="map-message" role="status">Загружаем карту…</div>
      </div>
      <div class="map-caption">
        <span>Нажмите на нужное место или перетащите метку.</span>
        <a id="satellite-link" href="https://yandex.ru/maps/?ll=39.7015%2C47.2357&amp;z=16&amp;l=sat" target="_blank" rel="noopener">Спутник в Яндекс Картах →</a>
      </div>
      <details class="coordinate-details" id="coordinate-details">
        <summary>Указать координаты</summary>
        <div class="coordinates">
          <div><label for="latitude">Широта</label><input id="latitude" type="text" inputmode="text" maxlength="14" placeholder="47.2357"></div>
          <div><label for="longitude">Долгота</label><input id="longitude" type="text" inputmode="text" maxlength="14" placeholder="39.7015"></div>
          <button type="button" class="quiet-button" id="apply-point">Применить</button>
        </div>
      </details>
    </section>

    <div class="roof-sizing">
      <div>
        <label for="roof-area">Свободная площадь крыши</label>
        <div class="unit-input roof-area-input">
          <input id="roof-area" type="text" inputmode="decimal" maxlength="14" placeholder="${industry ? 'Например, 1 800' : 'Например, 30'}" aria-describedby="roof-help">
          <span>м²</span>
        </div>
      </div>
      <div>
        <p class="field-note" id="roof-help">Вычтите окна, трубы, проходы и отступы. ${industry ? 'Для плоской крыши учтите промежутки между рядами.' : 'Если площадь неизвестна, задайте число панелей в параметрах.'}</p>
        <p class="roof-capacity" id="roof-capacity" aria-live="polite" hidden></p>
      </div>
    </div>

    <details class="station" id="station">
      <summary><span>Параметры станции</span><b id="station-summary"></b></summary>
      <div class="station-grid">
        <div><label for="panels">Количество панелей</label><input id="panels" type="number" min="1" step="1" aria-describedby="panels-help"></div>
        <div><label for="tilt">Наклон, °</label><input id="tilt" type="number" min="0" max="90" step="1" value="35"></div>
        <div><label for="azimuth">Направление</label>
          <select id="azimuth">
            <option value="180">Юг</option><option value="135">Юго-восток</option><option value="225">Юго-запад</option>
            <option value="90">Восток</option><option value="270">Запад</option><option value="0">Север</option>
            <option value="45">Северо-восток</option><option value="315">Северо-запад</option>
          </select>
        </div>
      </div>
      <p class="field-note" id="panels-help">Калькулятор подбирает количество по площади. Здесь можно задать меньше панелей. ${industry ? 'Без площади задайте количество вручную.' : 'Без площади и количества в расчёт войдут 10 панелей.'}</p>
    </details>

    ${industry ? industryFields : homeFields}

    <div class="form-actions">
      <button type="button" class="text-button" id="demo">Попробовать на примере Ростова</button>
      <button type="submit" class="primary-button" id="calculate">Рассчитать <span aria-hidden="true">→</span></button>
    </div>
    <p class="error" id="form-error" role="alert" hidden></p>
  </form>

  <section class="results" id="results" aria-labelledby="results-title" hidden>
    <div class="result-summary">
      <div class="result-heading">
        <h2 id="results-title" tabindex="-1">Результат расчёта</h2>
        <p id="result-location"></p>
        <button type="button" class="text-button" id="edit">Изменить данные</button>
      </div>
      <dl class="result-metrics">
        ${resultMetrics(industry)}
      </dl>
    </div>
    ${industry ? '' : '<p class="result-note" id="backup-note" hidden></p>'}
    <p class="result-note" id="economic-hint" hidden></p>
    ${industry ? '' : dailyProduction}
    <div class="production">
      <div class="chart-heading">
        <h3>Выработка по месяцам</h3>
        <p id="chart-value" aria-live="polite">кВт·ч</p>
      </div>
      <div class="chart" id="chart" aria-label="Помесячная выработка"></div>
      <p class="result-note" id="result-note"></p>
      <details class="result-method">
        <summary>Подробнее о расчёте</summary>
        <p id="result-method"></p>
        <p><a href="./methodology.html">Формулы и исходные данные →</a></p>
      </details>
    </div>
  </section>

  <details class="sources" id="sources">
    <summary>Источники данных и API</summary>
    <dl>
      <div><dt>Адрес</dt><dd>Поиск российских адресов через Photon по данным OpenStreetMap. Координаты крупных городов также есть во встроенном справочнике. <a href="https://photon.komoot.io/" target="_blank" rel="noopener">Photon →</a></dd></div>
      <div><dt>Карта</dt><dd>OpenStreetMap для проверки точки. Спутниковый снимок открывается в Яндекс Картах. <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap →</a></dd></div>
      <div><dt>Солнце</dt><dd>Помесячные данные NASA POWER по сетке 1°. Для точек вне встроенного архива калькулятор запрашивает NASA по координатам. <a href="https://power.larc.nasa.gov/docs/services/api/temporal/climatology/" target="_blank" rel="noopener">NASA POWER →</a> <a href="https://github.com/hssaleh/Heat-Route-to-Firm-H2/blob/2cacb152e327a3246be186a40f83c2bcf6bc75e7/data/nasa_param_GHI.csv" target="_blank" rel="noopener">Архив данных →</a></dd></div>
    </dl>
    <a class="source-method-link" href="./methodology.html">Формулы и исходные данные →</a>
  </details>
  `;
}
