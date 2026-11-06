import { Boxes, MapPin, PackageCheck, ScanLine, Truck, Warehouse } from '@lucide/vue'
import type { MenuGroup } from '../common/menu'

/** WMS sidebar (WmsInventory.html and the other WMS mockups). */
export const WMS_MENU: MenuGroup[] = [
  {
    key: 'wms',
    title: 'Read-only view',
    icon: Warehouse,
    to: '/wms/inventory',
    items: [
      { key: 'inventory', label: 'Inventory', to: '/wms/inventory', icon: Boxes },
      { key: 'stock-location', label: 'Stock Location', to: '/wms/stock-location', icon: MapPin },
      { key: 'epc-lookup', label: 'EPC Lookup', to: '/wms/epc-lookup', icon: ScanLine },
      { key: 'receiving', label: 'Receiving', to: '/wms/receiving', icon: PackageCheck },
      { key: 'shipping', label: 'Shipping', to: '/wms/shipping', icon: Truck },
    ],
  },
]
