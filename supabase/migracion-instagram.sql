-- Habilita Instagram como canal de primera clase sin debilitar RLS ni mezclar
-- sus consentimientos, límites, pruebas o trazas con WhatsApp.

alter table conversation_controls drop constraint if exists conversation_controls_channel_check;
alter table conversation_controls add constraint conversation_controls_channel_check
  check (channel in ('whatsapp', 'instagram', 'email'));

alter table channel_consents drop constraint if exists channel_consents_channel_check;
alter table channel_consents add constraint channel_consents_channel_check
  check (channel in ('whatsapp', 'instagram', 'email'));

alter table usage_ledger drop constraint if exists usage_ledger_channel_check;
alter table usage_ledger add constraint usage_ledger_channel_check
  check (channel in ('whatsapp', 'instagram', 'email'));

alter table shadow_decisions drop constraint if exists shadow_decisions_channel_check;
alter table shadow_decisions add constraint shadow_decisions_channel_check
  check (channel in ('whatsapp', 'instagram', 'email'));

alter table channel_test_runs drop constraint if exists channel_test_runs_channel_check;
alter table channel_test_runs add constraint channel_test_runs_channel_check
  check (channel in ('whatsapp', 'instagram', 'email'));

alter table channel_events drop constraint if exists channel_events_channel_check;
alter table channel_events add constraint channel_events_channel_check
  check (channel in ('whatsapp', 'instagram', 'email'));

alter table operation_failures drop constraint if exists operation_failures_source_check;
alter table operation_failures add constraint operation_failures_source_check
  check (source in ('whatsapp', 'instagram', 'email', 'oauth', 'ai'));

alter table operation_metrics drop constraint if exists operation_metrics_source_check;
alter table operation_metrics add constraint operation_metrics_source_check
  check (source in ('whatsapp', 'instagram', 'email'));
