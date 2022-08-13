
class BackgroundService {
    constructor () {
        this.host = 'http://77.222.52.153:8080';
        this.state = {
            running: false,
            status: 'not_active',
            validated: false,
            delay: 10 * 60,
            delay_between: 20,
            iteration: 0,
            abort: null
        };
        this.const = {
            gargos_list: 'https://loads.ati.su/webapi/loads/loads/get_full_loads_info_new?contactId=0',
            cargo_context: 'https://loads.ati.su/webapi/frontend/v2/cargos/creation_context/',
            commit_cargo: 'https://loads.ati.su/webapi/v2/cargos/'
        };
        this.store = {
            controller: null,
            cargosIDs: [],
            buffer: null
        };
    }

    init () {
        this.defineFetch();
        this.addSpeaker();
    }

    defineFetch() {
        this.fetch = (function(){
            this.store.controller = new AbortController();
            arguments[1] = Object.assign(arguments[1] || {}, {
                signal: this.store.controller.signal
            });
            return fetch(...arguments);
        }).bind(this);
    }

    addSpeaker() {
        chrome.runtime.onMessage.addListener(this.onBackgroundRecived.bind(this));
    }

    onBackgroundRecived(message) {
        switch (message.command) {
            case 'get_status': this.sendStatus(); break;
            case 'get_running': this.sendRunning(); break;
            case 'start': this.startRequest(); break;
            default: this.backgroundSend({command: 'error', reason: 'invalid command', value: message});
        }
    }

    backgroundSend(data) {
        chrome.runtime.sendMessage(data);
    }

    sendRunning() {
        this.backgroundSend({command: 'running', value: this.state.running});
    }

    sendStatus() {
        this.backgroundSend({command: 'status', value: {code: this.state.status}});
    }

    updateStatus(status) {
        status.itertaions = this.state.iteration;
        this.state.status = status.code;
        this.backgroundSend({command: 'status', value: status});
    }

    async startRequest() {
        if (this.state.running) {
            this.stop();
        } else {
            await this.start();
        }
        this.sendRunning();
    }

    async validate() {
        const keyRequest = await chrome.storage.sync.get(['auth_key']);
        const key = keyRequest.auth_key;
        const object = {auth_key: key};
    
        const response = await fetch(this.host + '/reg', {
            method: 'POST',
            body: JSON.stringify(object),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const json = await response.json();
        return json.status;
    }

    stop() {
        chrome.action.setBadgeText({text: ''});
        this.state.running = false;
        if (this.store.controller) this.store.controller.abort();
        this.updateStatus({code: 'force_stop'});
        this.sendRunning();
    }

    async start() {
        this.state.validated = await this.validate();
        if (this.state.validated) {
            this.state.running = true;
            this.run();
        } else {
            await chrome.storage.session.set({"session_validated": false});
            this.backgroundSend({command: 'validation_failed', value: 'wrong_key'});
        }
    }

    async run() {
        chrome.action.setBadgeText({text: String(this.state.iteration)});
        if (!this.state.running) return;
        this.updateStatus({code: 'on_settings_get'});
        if (!this.state.running) return;
        await this.updateStates();
        if (!this.state.running) return;
        this.updateStatus({code: 'on_cargo_list_request'});
        if (!this.state.running) return;
        await this.getGargosIDs();
        for (const [index, cargoID] of this.store.cargosIDs.entries()) {
            if (!this.state.running) return;
            await this.runCircle(index, cargoID);
        }
        if (!this.state.running) return;
        this.updateStatus({code: 'on_delay'});
        if (!this.state.running) return;
        await this.sleep(this.state.delay * 1e3);
        this.state.iteration++;
        if (!this.state.running) return;
        this.run();
    }

    async runCircle(index, cargoID) {
        try { 
            if (!this.state.running) return;
            this.updateStatus({code: 'on_cargo_request', data: {index: index, id: cargoID}});
            if (!this.state.running) return;
            const response = await this.getCargo(cargoID);
            if (!this.state.running) return;
            this.updateStatus({code: 'on_cargo_commit', data: {index: index, id: cargoID}});
            if (!this.state.running) return;
            const commit = await this.commitCargo(cargoID, response);
            if (!this.state.running) return;
            if ('error_code' in commit) throw new Error('error_code');
            if (!this.state.running) return;
            this.updateStatus({code: 'on_delay_between', data: {index: index, id: cargoID}});
            if (!this.state.running) return;
            await this.sleep(this.state.delay_between * 1e3);
        } catch (e) {
            this.stop();
            this.updateStatus({code: 'on_error'});
            this.sendRunning();
        }
    }

    async commitCargo(cargoID, response) {
        const commitCargResponse = await this.fetch(this.const.commit_cargo + cargoID, {
            method: 'PUT',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(response)
        });
        const commitCargResponseJSON = await commitCargResponse.json();
        return commitCargResponseJSON;
    }

    async getCargo(cargoID) {
        const currentCargoResponse = await this.fetch(this.const.cargo_context + cargoID);
        const cc = await currentCargoResponse.json();
        return (this.store.buffer = this.craftObject(cc));
    }

    craftObject(cc) {
        return {
            cargo_application: {
                boards: cc.cargo_application.boards.map(obj => {
                    delete obj.is_published;
                    delete obj.publication_time;
                    return obj;
                }),
                contacts: cc.cargo_application.contacts,
                payment: cc.cargo_application.payment,
                route: {
                    loading: {
                        cargos: cc.cargo_application.route.loading.cargos.map(obj => {
                            if (obj.sizes && obj.sizes.diameter === 0) delete obj.sizes.diameter;
                            obj.id = obj.cargo_id;
                            delete obj.cargo_id;
                            return obj;
                        }),
                        dates: cc.cargo_application.route.loading.dates,
                        location: {
                            city_id: cc.cargo_application.route.loading.city_id,
                            coordinates: cc.cargo_application.route.loading.coordinates,
                            address: cc.cargo_application.route.loading.address,
                            type: "manual" // <-----
                        }
                    },
                    unloading: cc.cargo_application.route.unloading,
                    way_points: cc.cargo_application.route.way_points
                },
                truck: cc.cargo_application.truck
            }
        };
    }

    async getGargosIDs() {
        const getYourCargosResponse = await this.fetch(this.const.gargos_list);
        const yourCargosJSON = await getYourCargosResponse.json();
        const cargosID = yourCargosJSON.Loads.map(i => i.Id);
        return (this.store.cargosIDs = cargosID);
    }

    async updateStates() {
        const store = await chrome.storage.sync.get(['delay', 'delay_between']);
        this.state = Object.assign(this.state, store);
    }

    sleep(millies) {
        return new Promise(resolve => setTimeout(resolve, millies));
    }
}

const BS = new BackgroundService();
BS.init();

// function sleep(millies) {
//     return new Promise(resolve => setTimeout(resolve, millies));
// }


// (async () => {
//     const getYourCargosResponse = await this.fetch('https://loads.ati.su/webapi/loads/loads/get_full_loads_info_new?contactId=0');
//     const yourCargosJSON = await getYourCargosResponse.json();
//     console.log(yourCargosJSON);
//     const cargosID = yourCargosJSON.Loads.map(i => i.Id);
//     console.log(cargosID);
//     for (const cargoID of cargosID) {
//         // await sleep(10e3);

//         const currentCargoResponse = await this.fetch('https://loads.ati.su/webapi/frontend/v2/cargos/creation_context/' + cargoID);
//         const cc = await currentCargoResponse.json();
//         const currentCargoApplication = {
//             cargo_application: {
//                 boards: cc.cargo_application.boards.map(obj => {
//                     delete obj.is_published;
//                     delete obj.publication_time;
//                     return obj;
//                 }),
//                 contacts: cc.cargo_application.contacts,
//                 payment: cc.cargo_application.payment,
//                 route: {
//                     loading: {
//                         cargos: cc.cargo_application.route.loading.cargos.map(obj => {
//                             if (obj.sizes && obj.sizes.diameter === 0) delete obj.sizes.diameter;
//                             obj.id = obj.cargo_id;
//                             delete obj.cargo_id;
//                             return obj;
//                         }),
//                         dates: cc.cargo_application.route.loading.dates,
//                         location: {
//                             city_id: cc.cargo_application.route.loading.city_id,
//                             coordinates: cc.cargo_application.route.loading.coordinates,
//                             address: cc.cargo_application.route.loading.address,
//                             type: "manual" // <-----
//                         }
//                     },
//                     unloading: cc.cargo_application.route.unloading,
//                     way_points: cc.cargo_application.route.way_points
//                 },
//                 truck: cc.cargo_application.truck
//             }
//         };


//         console.log(currentCargoApplication);

//         const commitCargResponse = await this.fetch('https://loads.ati.su/webapi/v2/cargos/' + cargoID, {
//             method: 'PUT',
//             headers: {
//                 'Accept': 'application/json',
//                 'Content-Type': 'application/json'
//             },
//             body: JSON.stringify(currentCargoApplication)
//         });

//         const commitCargResponseJSON = await commitCargResponse.json();

//         console.log('commited cargo:', cargoID, commitCargResponseJSON);

//     }

//     console.log('end');

// })//();

