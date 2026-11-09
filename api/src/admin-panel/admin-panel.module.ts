import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AdminPanelController } from './admin-panel.controller';
import { AdminPanelService } from './admin-panel.service';
import { AgentClient } from './agent.client';

@Module({
  imports: [AuditModule],
  controllers: [AdminPanelController],
  providers: [AdminPanelService, AgentClient],
})
export class AdminPanelModule {}
