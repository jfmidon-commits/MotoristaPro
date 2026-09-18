# Estabilidade da captura Android

## Escopo

A captura de Uber/99 é somente leitura. Nenhum serviço toca nos botões de aceitar ou recusar corrida. Imagens não são persistidas nem enviadas ao Supabase; somente métricas operacionais sanitizadas entram nas filas locais curtas.

## Proteções de execução prolongada

- Uber, 99 e detector do ciclo compartilham uma única lease de screenshot/OCR por processo.
- A lease expira em 12 segundos. Um callback ausente não mantém a captura bloqueada até o serviço reiniciar.
- Cada lease tem token. Um callback antigo não pode liberar o trabalho mais novo.
- O relógio monotônico do Android controla throttling, timeout, deduplicação e backoff.
- A captura 99 recua de 1,2 para no máximo 8 segundos quando não há oferta; mudanças fortes de janela voltam à resposta rápida.
- A captura de oferta para durante `pickup` e `in_trip`; o detector de ciclo usa OCR a cada 4/6/12 segundos conforme a fase.
- Diagnósticos repetidos são amostrados a cada 30 segundos por motivo, reduzindo serialização e escrita local.
- `AccessibilityNodeInfo` temporários são reciclados e callbacks vencidos descartam o bitmap.
- A tela mostra capturas iniciadas, disputas evitadas e recuperações do watchdog na sessão atual.

## Gates antes de publicar APK

1. TypeScript sem erros.
2. Testes Jest aprovados.
3. Testes Kotlin do governador, incluindo tempestade de eventos por seis horas simuladas.
4. Compilação Kotlin release.
5. Build release da APK.
6. Verificação do ZIP, assinatura Android e package id `com.motoristapro.app`.
7. Artefato nomeado com o SHA exato e acompanhado de checksum SHA-256.

O workflow `Android APK` interrompe a publicação se qualquer gate nativo, de assinatura ou de pacote falhar.

