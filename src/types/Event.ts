export interface Event<PayloadType extends {} = {}> {
    id: string;
    name: string;
    payload: PayloadType;
}
