import { Global, Module } from '@nestjs/common';
import { USER_DIRECTORY } from '../platform/context/request-context';
import { MASTER_DATA_PORT } from './master-data.port';
import { PrismaMasterDataAdapter } from './prisma-master-data.adapter';

/**
 * Binds MasterDataPort to the phase 1 adapter. Swapping to the real Master Data API = change useClass here.
 * Also serves as the platform's USER_DIRECTORY, because users are master data.
 */
@Global()
@Module({
  providers: [
    { provide: MASTER_DATA_PORT, useClass: PrismaMasterDataAdapter },
    { provide: USER_DIRECTORY, useExisting: MASTER_DATA_PORT },
  ],
  exports: [MASTER_DATA_PORT, USER_DIRECTORY],
})
export class MasterDataModule {}
