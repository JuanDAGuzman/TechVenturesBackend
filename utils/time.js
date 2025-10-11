// utils/time.js
export function minutesBetween(startHHMM, endHHMM) {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm); // asume mismo día (que es tu caso)
}
