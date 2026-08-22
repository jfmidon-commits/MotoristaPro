# MotoristaPro — Auditoria UX/Mobile (baseline)

## Objetivo
Reduzir toques e tempo de interação durante o trabalho sem ampliar o escopo funcional do MVP.

## Evidências do smoke test em Android real
- Login e dashboard funcionam em APK standalone.
- Cadastro de veículo exige poucos campos e funcionou bem.
- Início/encerramento de turno é compreensível, mas a navegação ainda pode ser mais direta.
- O status de sincronização precisa permanecer visível e confiável porque o app é offline-first.
- Receita e despesa são ações recorrentes e devem exigir o mínimo de interação possível durante um turno.

## Prioridade P0 — uso durante o turno
1. Entrada de receita/despesa em poucos toques.
2. Ações principais do turno sempre próximas e fáceis de alcançar.
3. Estado offline/sincronização inequívoco, sem falso positivo.
4. Odômetro com teclado numérico e validação imediata.
5. Preservar dados locais em toda navegação e atualização do APK.

## Prioridade P1 — leitura rápida
1. Dashboard deve destacar apenas métricas úteis no momento.
2. Turno ativo deve mostrar receita, lucro, duração e ações rápidas sem exigir rolagem longa.
3. Histórico e manutenção ficam como ações secundárias.

## Primeira implementação
- Autofocus no campo de valor em Receita/Despesa.
- Atalhos de valores frequentes para reduzir digitação.
- Tecla de ação do teclado salva o lançamento quando possível.
- Manter seleção automática do veículo do turno.

## Critério de aceite da fase UX
Um motorista deve conseguir registrar uma receita ou despesa comum em poucos segundos, com uma mão, sem precisar navegar por telas secundárias ou preencher campos desnecessários.
