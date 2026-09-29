-- 0029_midia_do_chat.sql
-- Fotos, vídeos, áudios e documentos do chat (enviados e recebidos).
-- Bucket PRIVADO: não tem política de acesso pra ninguém — o navegador só
-- envia por link assinado de uso único gerado pelo servidor (depois de
-- conferir a conversa) e só vê por link assinado temporário. Caminho:
-- <org_id>/<conversation_id>/<id>/<arquivo>. Idempotente.

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-media', 'chat-media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
