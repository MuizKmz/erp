import { Module, type OnModuleInit } from '@nestjs/common';
import { PermissionCatalogue } from '../platform/context/permission-catalogue';
import { WmsDashboardController } from './wms-dashboard.controller';
import { WmsController } from './wms.controller';
import { WmsIndicators } from './wms.indicators';
import { WMS_PERMISSION_CATALOGUE } from './wms.permissions';
import { WmsQuery } from './wms.query';

/** The read-only WMS view (W00–W05). It reads a client's WMS and owns no tables. */
@Module({
  controllers: [WmsController, WmsDashboardController],
  providers: [WmsQuery, WmsIndicators],
})
export class WmsModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionCatalogue) {}

  onModuleInit(): void {
    this.permissions.register(WMS_PERMISSION_CATALOGUE);
  }
}
