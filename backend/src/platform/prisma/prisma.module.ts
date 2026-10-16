import { Global, Module } from '@nestjs/common';
import { ScopeRegistry } from '../scope/scope.registry';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [ScopeRegistry, PrismaService],
  exports: [ScopeRegistry, PrismaService],
})
export class PrismaModule {}
