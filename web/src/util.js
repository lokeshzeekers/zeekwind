// small helpers shared by the solar screens
export const f = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '--' : Number(v).toFixed(d));
export const hhmmss = (ms) => new Date(ms).toLocaleTimeString('en-GB');
export const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const energy = (kwh) => (kwh == null ? '--' : kwh >= 10000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${f(kwh, 1)} kWh`);
export const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
export const span = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5) + 1;
export const autoBucket = (days) => (days <= 1 ? 300 : days <= 7 ? 900 : days <= 31 ? 3600 : 21600);

// Solar yield maths, from one day_summary row and the plant's installed kWp
export const insolation = (d) => (d && d.irr_wh > 0 ? d.irr_wh / 1000 : null);                       // kWh/m2 ("peak sun hours")
export const specificYield = (kwh, kwp) => (kwp > 0 && kwh != null ? kwh / kwp : null);               // kWh per kWp
export const perfRatio = (kwh, kwp, ins) => (kwp > 0 && ins > 0 && kwh != null ? (kwh / (kwp * ins)) * 100 : null); // %
export const co2 = (kg) => (kg == null ? '--' : kg >= 1000 ? `${(kg / 1000).toFixed(2)} t` : `${f(kg, 0)} kg`);
