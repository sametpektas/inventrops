import axios from 'axios';
import https from 'https';

// Mock config - you should replace these with actual values from your .env or DB
const config = {
  url: 'REPLACE_WITH_OME_URL',
  username: 'REPLACE_WITH_USERNAME',
  password: 'REPLACE_WITH_PASSWORD'
};

async function testDellApi() {
  const client = axios.create({
    baseURL: config.url,
    timeout: 30000,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false
    })
  });

  try {
    console.log('Logging in...');
    const loginRes = await client.post('/api/SessionService/Sessions', {
      UserName: config.username,
      Password: config.password,
      SessionType: 'API'
    });

    const token = loginRes.headers['x-auth-token'];
    client.defaults.headers.common['X-Auth-Token'] = token;
    console.log('Login successful');

    console.log('Fetching first 5 devices...');
    const devicesRes = await client.get('/api/DeviceService/Devices?$top=5');
    const devices = devicesRes.data.value || [];

    for (const d of devices) {
      console.log(`\nTesting device: ${d.DeviceName} (ID: ${d.Id})`);
      
      // Try fetching all inventory types to see what's available
      try {
        const invSummaryRes = await client.get(`/api/DeviceService/Devices(${d.Id})/InventoryDetails`);
        console.log('Available inventory types:', invSummaryRes.data.map(i => i.InventoryType));
      } catch (e) {
        console.log('Failed to fetch inventory types summary');
      }

      const typesToTest = ['cpuInfo', 'memoryInfo', 'processorInfo', 'Memory'];
      for (const type of typesToTest) {
        try {
          const res = await client.get(`/api/DeviceService/Devices(${d.Id})/InventoryDetails?inventoryType=${type}`);
          console.log(`Result for type "${type}":`, JSON.stringify(res.data, null, 2).substring(0, 500));
        } catch (e) {
          console.log(`Failed for type "${type}"`);
        }
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testDellApi();
