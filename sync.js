// ============================================================
// Amplifier → Kickflip Inventory Sync
// ============================================================

const AMPLIFIER_API_KEY = process.env.AMPLIFIER_API_KEY;
const KICKFLIP_API_KEY  = process.env.KICKFLIP_API_KEY;

const AMPLIFIER_INVENTORY_URL = 'https://api.amplifier.com/reports/inventory/current';
const KICKFLIP_LOCATION_URL   = 'https://api.mycustomizer.com/v1/inventory/locations/default';
const KICKFLIP_INVENTORY_URL  = 'https://api.mycustomizer.com/v1/inventory/locations';


// ============================================================
// STEP 1: Fetch inventory from Amplifier
// ============================================================
async function fetchAmplifierInventory() {
  console.log('Fetching inventory from Amplifier...');

  const encodedKey = Buffer.from(AMPLIFIER_API_KEY).toString('base64');

  const response = await fetch(AMPLIFIER_INVENTORY_URL, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${encodedKey}`,
      'Content-Type': 'application/json',
    },
  });

  console.log(`  Amplifier response status: ${response.status}`);

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Amplifier API error: ${response.status} ${response.statusText} — ${errBody}`);
  }

  const data = await response.json();
  const items = data.inventory;

  if (!Array.isArray(items)) {
    throw new Error(`Unexpected Amplifier response — no "inventory" array found. Got: ${JSON.stringify(data).slice(0, 200)}`);
  }

  console.log(`  Found ${items.length} SKUs in Amplifier.`);
  return items;
}


// ============================================================
// STEP 2: Get the Kickflip location ID
// ============================================================
async function fetchKickflipLocationId() {
  console.log('Fetching Kickflip location ID...');

  const response = await fetch(KICKFLIP_LOCATION_URL, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${KICKFLIP_API_KEY}`,
      'x-tenant-id': 'hausoftiles',
      'Content-Type': 'application/json',
    },
  });

  console.log(`  Kickflip location response status: ${response.status}`);

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Kickflip location API error: ${response.status} ${response.statusText} — ${errBody}`);
  }

  const data = await response.json();
  const locationId = data.id || data.locationId;

  if (!locationId) {
    throw new Error(`Could not find a location ID in the Kickflip response. Got: ${JSON.stringify(data).slice(0, 200)}`);
  }

  console.log(`  Kickflip location ID: ${locationId}`);
  return locationId;
}


// ============================================================
// STEP 3: Push updated quantities to Kickflip
// ============================================================
async function updateKickflipInventory(locationId, amplifierItems) {
  console.log('Pushing inventory updates to Kickflip...');

  const updates = amplifierItems
    .filter(item => item.sku)
    .map(item => ({
      sku:   item.sku,
      stock: item.quantity_available ?? 0,
    }));

  if (updates.length === 0) {
    console.log('  No SKU-matched items to update. Make sure Kickflip variants have SKUs assigned.');
    return;
  }

  console.log(`  Sending ${updates.length} SKU updates to Kickflip...`);

  const response = await fetch(`${KICKFLIP_INVENTORY_URL}/${locationId}/items/bulk`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KICKFLIP_API_KEY}`,
      'x-tenant-id': 'hausoftiles',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ updates }),
  });

  console.log(`  Kickflip update response status: ${response.status}`);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Kickflip update failed: ${response.status} ${response.statusText} — ${errorBody}`);
  }

  console.log(`  Successfully updated ${updates.length} SKUs in Kickflip.`);
}


// ============================================================
// MAIN: Run the sync sequentially so each step is visible
// ============================================================
async function runSync() {
  const startTime = new Date().toISOString();
  console.log(`\n========================================`);
  console.log(`Inventory sync started at ${startTime}`);
  console.log(`========================================`);

  if (!AMPLIFIER_API_KEY || !KICKFLIP_API_KEY) {
    throw new Error(
      'Missing API keys. Make sure AMPLIFIER_API_KEY and KICKFLIP_API_KEY ' +
      'are set as environment variables.'
    );
  }

  try {
    // Run sequentially so we can see exactly where a failure occurs
    const amplifierInventory = await fetchAmplifierInventory();
    const kickflipLocationId = await fetchKickflipLocationId();
    await updateKickflipInventory(kickflipLocationId, amplifierInventory);

    console.log(`\nSync completed successfully at ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`\nSync FAILED: ${error.message}`);
    process.exit(1);
  }
}

runSync();
