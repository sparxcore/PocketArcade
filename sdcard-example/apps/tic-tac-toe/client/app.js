"use strict";

(() => {
  window.PocketArcadeApps = window.PocketArcadeApps || {};

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  window.PocketArcadeApps["tic-tac-toe"] = {
    mount(container, arcade) {
      container.replaceChildren();
      const root = element("section", "ttt-app");
      const seats = element("div", "ttt-seats");
      const seatX = element("div", "ttt-seat");
      const seatO = element("div", "ttt-seat");
      seatX.append(element("span", "", "PLAYER X"), element("strong", "", "Open"));
      seatO.append(element("span", "", "PLAYER O"), element("strong", "", "Open"));
      seats.append(seatX, seatO);

      const status = element("p", "ttt-status", "Loading table…");
      status.setAttribute("aria-live", "polite");
      const board = element("div", "ttt-board");
      board.setAttribute("role", "grid");
      board.setAttribute("aria-label", "Tic-Tac-Toe board");
      const cells = [];
      for (let index = 0; index < 9; index += 1) {
        const cell = element("button", "ttt-cell", "");
        cell.type = "button";
        cell.dataset.cell = String(index);
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `Square ${index + 1}, empty`);
        cell.addEventListener("click", () => {
          const match = arcade.game.currentMatch();
          if (match) arcade.game.send(match.matchId, "move", { cell: index });
        });
        cells.push(cell);
        board.append(cell);
      }

      const actions = element("div", "ttt-actions");
      const join = element("button", "primary", "Join game");
      join.type = "button";
      join.addEventListener("click", () => arcade.game.join("tic-tac-toe"));
      const leave = element("button", "", "Leave seat");
      leave.type = "button";
      leave.addEventListener("click", () => {
        const match = arcade.game.currentMatch();
        if (match) arcade.game.leave(match.matchId);
      });
      const reset = element("button", "", "Play again");
      reset.type = "button";
      reset.addEventListener("click", () =>
        arcade.game.join("tic-tac-toe"));
      actions.append(join, leave, reset);
      const error = element("p", "ttt-error", "");
      error.setAttribute("role", "alert");
      root.append(seats, status, board, actions, error);
      container.append(root);

      const render = (game) => {
        if (!game) return;
        const x = game.players?.X || null;
        const o = game.players?.O || null;
        seatX.querySelector("strong").textContent = x?.nickname || "Open";
        seatO.querySelector("strong").textContent = o?.nickname || "Open";
        const ownMark = x?.id === arcade.profile?.id ? "X"
          : o?.id === arcade.profile?.id ? "O" : null;
        const boardState = Array.isArray(game.board) ? game.board : [];
        cells.forEach((cell, index) => {
          const mark = boardState[index] || "";
          cell.textContent = mark;
          cell.setAttribute(
            "aria-label",
            `Square ${index + 1}, ${mark || "empty"}`
          );
          cell.disabled = !(game.status === "playing" &&
            ownMark === game.turn && !mark);
        });

        if (game.status === "playing") {
          const turnName = game.players?.[game.turn]?.nickname || game.turn;
          status.textContent = ownMark === game.turn
            ? "Your turn"
            : ownMark
              ? `${turnName}'s turn`
              : `Spectating · ${turnName}'s turn`;
        } else if (game.status === "won") {
          const winner = game.players?.[game.winner]?.nickname || game.winner;
          status.textContent = `${winner} wins!`;
        } else if (game.status === "draw") {
          status.textContent = "Draw game";
        } else {
          status.textContent = ownMark
            ? "Waiting for another player"
            : x && o
              ? "Spectating · next round will begin after a seat opens"
              : "Choose Join game to take an open seat";
        }
        join.hidden = Boolean(ownMark) || Boolean(x && o);
        leave.hidden = !ownMark;
        reset.hidden = !ownMark ||
          !["won", "draw"].includes(game.status);
      };

      let currentMatch = arcade.game.currentMatch();
      const stopMatch = arcade.game.onMatch((match) => {
        currentMatch = match;
        const ownSeat = match.seats
          ?.find((seat) => seat.seat === match.you?.seat);
        if (match.you?.role === "player" && !ownSeat?.ready) {
          arcade.game.ready(match.matchId);
        }
      });
      const stopGame = arcade.game.onSnapshot((snapshot) => {
        render(snapshot.payload);
      });
      const stopError = arcade.game.onError((value) => {
        error.textContent = value?.message || "The game action failed.";
        window.setTimeout(() => { error.textContent = ""; }, 5000);
      });
      const initialSnapshot = arcade.game.currentSnapshot();
      if (initialSnapshot) render(initialSnapshot.payload);
      if (currentMatch?.you?.role === "player") {
        arcade.game.ready(currentMatch.matchId);
      }
      return () => {
        stopMatch();
        stopGame();
        stopError();
        container.replaceChildren();
      };
    },
  };
})();
