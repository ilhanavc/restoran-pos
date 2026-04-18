export const reservationsMixin = {
  getReservations(params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
    return this.get(`/reservations${q ? '?' + q : ''}`);
  },
  createReservation(body) { return this.post('/reservations', body); },
  updateReservation(id, body) { return this.patch(`/reservations/${id}`, body); },
  deleteReservation(id) { return this.delete(`/reservations/${id}`); },
};
