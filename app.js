// Arena Esportiva - Lógica de Controle de Operadores (Ajuste cirúrgico em app.js)
// Mantém 100% da identidade visual, layout e estrutura original do sistema intactos.

async function salvarPermissoesOperador(userId, statusAcesso, partidasSelecionadas, permitirCadastros, motivo) {
    try {
        const db = firebase.firestore();
        await db.collection("usuarios").doc(userId).update({
            statusAcesso: statusAcesso,
            partidasAutorizadas: partidasSelecionadas,
            operadorCadastros: permitirCadastros, // Permite cadastrar e gerenciar equipes, jogadores e partidas
            motivoAlteracao: motivo,
            atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log("Permissões de operador atualizadas com sucesso!");
    } catch (error) {
        console.error("Erro ao salvar permissões:", error);
        throw error;
    }
}

// Verificação de permissões para ações de jogo (jogadores, equipes, partidas e placares)
function verificarPermissaoOperador(usuarioAtual, acao) {
    if (!usuarioAtual) return false;
    if (usuarioAtual.admin) return true;
    
    if (usuarioAtual.operadorCadastros || usuarioAtual.operador) {
        const acoesPermitidas = ['cadastrar_equipe', 'cadastrar_jogador', 'criar_partida', 'marcar_placar'];
        return acoesPermitidas.includes(acao);
    }
    
    return false;
}
