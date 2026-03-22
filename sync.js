// ============================================================
// Amplifier → Kickflip Inventory Sync
// ============================================================
// Fetches current inventory from Amplifier (3PL) and pushes
// the available quantities into Kickflip to prevent overselling.
// ============================================================

// --- CONFIGURATION ---
// Values are read from environment variables so API keys are
// never written directly into the code.

const AMPLIFIER_API_KEY = process.env.AMPLIFIER_API_KEY;
const KICKFLIP_API_KEY  = process.env.KICKFLIP_API_KEY;

// Confirmed from Amplifier API docs (amplifier.docs.apiary.io)
const AMPLIFIER_INVENTORY_URL = 'https://api.amplifier.com/reports/inventory/current';

// Kickflip endpoints (confirmed from gokickflip.com API docs)
const KICKFLIP_LOCATION_URL  = 'https://api.mycustomizer.com/v1/inventory/locations/default';
const KICKFLIP_INVENTORY_URL = 'https://api.mycustomizer.com/v1/inventory/locations';


// ============================================================
// STEP 1: Fetch inventory from Amplifier
// ============================================================
// Amplifier uses HTTP Basic auth. The API key is Base64-encoded
// and passed in the Authorization header.
//
// Confirmed response format:
// {
//   "inventory": [
//     {
//       "sku": "ABC-123",
//       "quantity_available": 50,
//       "quantity_on_hand": 100,
//       "quantity_committed": 47,
//       "quantity_expected": 200,
//       "safety_stock": 3,
//       "made_to_order": false
//     },
//     ...
//   ]
// }

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

  if (!response.ok) {
    throw new Error(`Amplifier API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const items = data.inventory;

  if (!Array.isArray(items)) {
    throw new Error('Unexpected response from Amplifier: "inventory" array not found.');
  }

  console.log(`  Found ${items.length} SKUs in Amplifier.`);
  return items;
}


// ============================================================
// STEP 2: Get the Kickflip location ID
// ============================================================
// Kickflip organises inventory under "locations". Every account
// has a default location created automatically. We need its ID
// before pushing inventory updates.

async function fetchKickflipLocationId() {
  console.log('Fetching Kickflip location ID...');

  const response = await fetch(KICKFLIP_LOCATION_URL, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${KICKFLIP_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Kickflip location API error: ${response.status} ${response.statusText} — ${errBody}`);
  }

  const data = await response.json();
  const locationId = data.id || data.locationId;

  if (!locationId) {
    throw new Error('Could not find a location ID in the Kickflip response.');
  }

  console.log(`  Kickflip location ID: ${locationId}`);
  return locationId;
}


// ============================================================
// STEP 3: Push updated quantities to Kickflip
// ============================================================
// We use quantity_available from Amplifier as the stock value
// in Kickflip -- that's the number you can actually promise to
// customers (on hand minus already-committed orders).

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

  const response = await fetch(`${KICKFLIP_INVENTORY_URL}/${locationId}/items/bulk`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${KICKFLIP_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ updates }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Kickflip update failed: ${response.status} ${response.statusText}\n${errorBody}`);
  }

  console.log(`  Successfully updated ${updates.length} SKUs in Kickflip.`);
}


// ============================================================
// MAIN: Run the sync
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
    const [amplifierInventory, kickflipLocationId] = await Promise.all([
      fetchAmplifierInventory(),
      fetchKickflipLocationId(),
    ]);

    await updateKickflipInventory(kickflipLocationId, amplifierInventory);

    console.log(`\nSync completed successfully at ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`\nSync FAILED: ${error.message}`);
    process.exit(1);
  }
}

runSync();
