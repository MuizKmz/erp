import { Module, type OnModuleInit } from '@nestjs/common';
import { PermissionCatalogue } from '../platform/context/permission-catalogue';
import { WmsController } from './wms.controller';
import { WMS_PERMISSION_CATALOGUE } from './wms.permissions';
import { WmsQuery } from './wms.query';

/** The read-only WMS view (W01–W05). It reads a client's WMS and owns no tables. */
@Module({
  controllers: [WmsController],
  providers: [WmsQuery],
})
export class WmsModule implements OnModuleInit {
  constructor(private readonly permissions: PermissionCatalogue) {}

  onModuleInit(): void {
    this.permissions.register(WMS_PERMISSION_CATALOGUE);
  }
}
