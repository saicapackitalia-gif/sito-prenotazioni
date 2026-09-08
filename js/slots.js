/* ===== SLOT, ORARI E DISPONIBILITÀ CONDIVISA TRA BAIE =====
   Calcolo degli orari reali di uno slot, generazione della griglia slot
   per baia, e le regole di disponibilità (capacità condivisa tra baie,
   slot non consecutivi) usate sia dal rendering sia dai controlli in
   js/bookings-api.js prima di creare una prenotazione. Per questo deve
   essere caricato PRIMA di js/bookings-api.js (e prima dello script
   principale): funzioni come createBooking() chiamano direttamente
   canBookSlot()/hasConsecutiveConflict()/slotTimeRange() definite qui.

   slotTimeRange() è il punto unico di calcolo dell'orario di uno slot per
   un dato vehicle_id — evita di ripetere il bug storico già corretto in
   passato (uso della griglia SLOTS dell'ultimo mezzo caricato invece di
   quella del mezzo giusto). Codice spostato senza modifiche da
   index.html — vedi docs/PIANO_REFACTORING.md. */

function isAdmin(){
  return currentUser && currentUser.email === ADMIN_EMAIL_CONST;
}

// Time range [start,end) in minutes-from-midnight actually occupied by a booking
// on this vehicle/slot_index. Mirrors the DB functions orario_da_slot/orario_fine_slot
// and the trg_verifica_capacita trigger, so the UI and the DB agree on what's free.
function slotTimeRange(vehicleId, slotIdx){
  const v = VEHICLES.find(x=>x.id===vehicleId);
  if(!v) return null;
  const start = v.startHour*60 + slotIdx*v.slotStep;
  return {start, end: start + (v.durataSlot||v.slotStep)};
}
function rangesOverlap(aStart,aEnd,bStart,bEnd){ return aStart < bEnd && bStart < aEnd; }

// Which slot_index values are valid BOOKING START points for this vehicle.
// Since every vehicle's step now matches its own real duration (Fogli 45/45,
// Scatole 30/30, Depositi 30/30), every generated tick is naturally a valid,
// non-overlapping start point. Kept as a hook in case a vehicle needs
// restricting again in the future.
function isBookableSlotIndex(vehicleId, slotIdx){
  return true;
}

// Generate slots for a specific vehicle
function generateSlotsForVehicle(v){
  const s=[];
  let total=v.startHour*60;
  const end=v.endHour*60;
  while(total<end){s.push({hour:Math.floor(total/60),min:total%60});total+=v.slotStep;}
  return s;
}

// Default SLOTS for selected vehicle (updated dynamically)
function generateSlots(){
  return generateSlotsForVehicle(VEHICLES[0]);
}

// Prenotazioni del giorno selezionato, per TUTTE le baie (necessario per il
// controllo di capacità condivisa). Popolata da loadAndRender() nello
// script principale e da createBooking() in js/bookings-api.js.
let currentBookings=[];

// ===== CROSS-BAIA AVAILABILITY =====
// Rules:
//   - 2 carrellisti totali
//   - Fogli: max 1 per slot
//   - Depositi: max 1 per slot
//   - Scatole: max 2 per slot (ma limitato dai carrellisti disponibili)
//   - Totale prenotazioni su TUTTE le baie nello stesso slot_index <= 2

const TOTAL_CARRELLISTI = 2;

// Count bookings on a specific vehicle/slot whose real time range OVERLAPS this slot's
// time range (not just exact slot_index match) — mirrors the DB trigger's overlap check,
// needed because Fogli bookings last 60 minutes but the grid ticks every 30.
function countBookingsForSlot(vehicleId, slotIdx){
  const target = slotTimeRange(vehicleId, slotIdx);
  if(!target) return 0;
  return currentBookings.filter(b => {
    if(b.vehicle_id !== vehicleId) return false;
    const r = slotTimeRange(b.vehicle_id, parseInt(b.slot_index));
    return r && rangesOverlap(target.start, target.end, r.start, r.end);
  }).length;
}

// Count total carrellisti busy across ALL baie whose booking time range overlaps [start,end)
function totalBusyInRange(start, end){
  let total = 0;
  currentBookings.forEach(b => {
    const r = slotTimeRange(b.vehicle_id, parseInt(b.slot_index));
    if(r && rangesOverlap(start, end, r.start, r.end)) total++;
  });
  return total;
}
// Kept for compatibility with any other caller expecting hour/min at 30-min granularity
function totalBusyAtTime(hour, min){
  const start = hour*60+min;
  return totalBusyInRange(start, start+30);
}

// Same rule as the DB trigger trg_slot_non_consecutivi: same user (by account,
// or by phone number for guests, already reflected in b.mine) can't book two
// adjacent slots on Fogli/Scatole. Admin is exempt.
function hasConsecutiveConflict(vehicleId, slotIdx){
  if(vehicleId !== 'baia-1' && vehicleId !== 'baia-2') return false;
  if(isAdmin()) return false;
  return currentBookings.some(b => {
    if(b.vehicle_id !== vehicleId) return false;
    const bi = parseInt(b.slot_index);
    if(bi !== slotIdx-1 && bi !== slotIdx+1) return false;
    return b.mine;
  });
}

// Can we add one more booking to vehicleId at slotIdx?
function canBookSlot(vehicleId, slotIdx){
  const v = VEHICLES.find(x => x.id === vehicleId);
  if(!v) return false;
  const vSlots = generateSlotsForVehicle(v);
  if(slotIdx >= vSlots.length) return false;
  const target = slotTimeRange(vehicleId, slotIdx);
  if(!target) return false;

  // Check 1: vehicle-specific max not exceeded (by overlap, not exact index)
  const currentCount = countBookingsForSlot(vehicleId, slotIdx);
  if(currentCount >= v.maxPerSlot) return false;

  // Check 2: total carrellisti not exceeded (by overlap, across ALL baie)
  const busy = totalBusyInRange(target.start, target.end);
  if(busy >= TOTAL_CARRELLISTI) return false;

  return true;
}

// Legacy compatibility: returns max allowed (used in render)
function maxAllowedForSlot(vehicleId, slotIdx){
  const v = VEHICLES.find(x => x.id === vehicleId);
  if(!v) return 0;
  const vSlots = generateSlotsForVehicle(v);
  if(slotIdx >= vSlots.length) return 0;
  const target = slotTimeRange(vehicleId, slotIdx);
  if(!target) return 0;
  const busy = totalBusyInRange(target.start, target.end);
  const available = TOTAL_CARRELLISTI - busy;
  const currentCount = countBookingsForSlot(vehicleId, slotIdx);
  return Math.min(v.maxPerSlot, currentCount + Math.max(0, available));
}
