import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { LinkRegistry } from '../links/link-registry';
import { LinksModule } from '../links/links.module';
import { PaperAdapterRegistry } from '../paperwork/adapters';
import { PaperworkModule } from '../paperwork/paperwork.module';
import { PlacesModule } from '../places/places.module';
import { User } from '../users/user.entity';
import { FaultPhoto, FaultReport } from './fault.entities';
import { FAULT_LINKS } from './fault.links';
import { FAULT_READER } from './fault.reader';
import { FaultsController } from './faults.controller';
import { FaultsService } from './faults.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FaultReport, FaultPhoto, User]),
    PlacesModule,
    FilesModule,
    AuditModule,
    LinksModule,
    PaperworkModule,
  ],
  controllers: [FaultsController],
  providers: [FaultsService],
})
export class FaultsModule implements OnModuleInit {
  constructor(
    private links: LinkRegistry,
    private papers: PaperAdapterRegistry,
  ) {}

  onModuleInit() {
    this.links.register('fault', FAULT_LINKS);
    this.papers.registerReader('fault', FAULT_READER);
  }
}
