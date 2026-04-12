import { DiscoveredDevice } from './dell';

export class HPEOneViewAdapter {
  constructor(private config: any) {}

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[HPE] Discovering devices from ${this.config.url}...`);
    return [
      {
        serial_number: 'HPE-TEST-999',
        hostname: 'hpe-proliant-01',
        vendor_name: 'HPE',
        model_name: 'ProLiant DL380 Gen10',
        device_type: 'server',
        ip_address: '192.168.20.100'
      }
    ];
  }
}
