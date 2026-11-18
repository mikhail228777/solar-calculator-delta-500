export const PANEL = Object.freeze({ kilowatts: 0.5, squareMeters: 1.961 * 1.134 });
export const SYSTEM_LOSS = 0.20;
export const SELF_USE = 0.60;

export const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MID_MONTH = [17, 46, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];
const ALBEDO = 0.20;
const radians = degrees => degrees * Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function diffuseFraction(clearness) {
  if (clearness <= 0.22) return 1 - 0.09 * clearness;
  if (clearness > 0.8) return 0.165;
  return clamp(0.9511 - 0.1604 * clearness + 4.388 * clearness ** 2
    - 16.638 * clearness ** 3 + 12.336 * clearness ** 4, 0, 1);
}

function tiltedIrradiation(horizontal, month, latitude, tilt, azimuth) {
  if (horizontal === 0) return 0;

  // Use a representative day for each month to estimate the beam incidence ratio.
  const day = MID_MONTH[month];
  const declination = radians(23.45) * Math.sin(2 * Math.PI * (284 + day) / 365);
  const phi = radians(latitude);
  const beta = radians(tilt);
  const gamma = radians(azimuth - 180);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinDecl = Math.sin(declination);
  const cosDecl = Math.cos(declination);
  const cosTilt = Math.cos(beta);
  const sinTilt = Math.sin(beta);
  const south = Math.cos(gamma);
  const west = Math.sin(gamma);
  const sunset = Math.acos(clamp(-Math.tan(phi) * Math.tan(declination), -1, 1));
  const solarConstant = 1.367 * (1 + 0.033 * Math.cos(2 * Math.PI * day / 365));
  const aboveAtmosphere = 24 / Math.PI * solarConstant
    * (cosPhi * cosDecl * Math.sin(sunset) + sunset * sinPhi * sinDecl);
  if (aboveAtmosphere < 0.001) return 0;

  let totalHorizontal = 0;
  let totalInclined = 0;
  for (let step = 0; step < 144; step += 1) {
    const hour = -Math.PI + (step + 0.5) * 2 * Math.PI / 144;
    const cosHour = Math.cos(hour);
    const zenithIncidence = sinPhi * sinDecl + cosPhi * cosDecl * cosHour;
    if (zenithIncidence <= 0) continue;
    const panelIncidence = sinDecl * (sinPhi * cosTilt - cosPhi * sinTilt * south)
      + cosDecl * cosHour * (cosPhi * cosTilt + sinPhi * sinTilt * south)
      + cosDecl * Math.sin(hour) * sinTilt * west;
    totalHorizontal += zenithIncidence;
    totalInclined += Math.max(0, panelIncidence);
  }

  const beamRatio = totalHorizontal ? Math.min(6, totalInclined / totalHorizontal) : 0;
  const diffuse = diffuseFraction(clamp(horizontal / aboveAtmosphere, 0, 1));
  const skyView = (1 + cosTilt) / 2;
  const groundView = (1 - cosTilt) / 2;

  return horizontal * ((1 - diffuse) * beamRatio + diffuse * skyView + ALBEDO * groundView);
}

export function calculateSolar(irradiation, { lat, tilt, azimuth, panels, bill, tariff, cost }) {
  const power = panels * PANEL.kilowatts;
  const monthly = irradiation.map((dailyIrradiation, index) => (
    tiltedIrradiation(dailyIrradiation, index, lat, tilt, azimuth)
      * DAYS[index] * power * (1 - SYSTEM_LOSS)
  ));
  const annual = monthly.reduce((total, energy) => total + energy, 0);

  // The bill implies an average monthly load. Cap each month's used energy at that load.
  const hasEconomics = bill !== null && tariff !== null;
  const saving = hasEconomics
    ? Math.min(bill * 12, monthly.reduce((total, energy) => total + Math.min(energy * SELF_USE * tariff, bill), 0))
    : null;
  const used = saving === null ? null : saving / tariff;
  const payback = cost !== null && saving > 0 ? cost / saving : null;

  return { monthly, annual, power, used, saving, payback, panelArea: panels * PANEL.squareMeters };
}
