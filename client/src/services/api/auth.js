export const authMixin = {
  login(email, password, businessId) {
    const body = { email, password };
    if (businessId) body.business_id = businessId;
    return this.post('/auth/login', body, true);
  },
  forgotPassword(email, businessId) {
    const body = { email };
    if (businessId) body.business_id = businessId;
    return this.post('/auth/forgot-password', body);
  },
  changePassword(email, oldPassword, newPassword, businessId) {
    const body = { email, oldPassword, newPassword };
    if (businessId) body.business_id = businessId;
    return this.post('/auth/change-password', body);
  },
  me() { return this.get('/auth/me'); },
};
