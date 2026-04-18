export const authMixin = {
  login(email, password, businessId) {
    const body = { email, password };
    if (businessId) body.business_id = businessId;
    return this.post('/auth/login', body, true);
  },
  me() { return this.get('/auth/me'); },
};
