import { Deferred } from '../shared/deferred';
import { Injectable } from '@angular/core';
import { IDataObject } from '../interfaces/data-object';
import { NoDuplicatedHttpCallsService } from '../services/noduplicatedhttpcalls.service';
import { Core } from '../core';
import { Base } from '../services/base';
import { HttpClient, HttpRequest, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs/Observable';
import { JsonapiConfig } from '../jsonapi-config';

import 'rxjs/add/operator/toPromise';
import 'rxjs/add/operator/map';

@Injectable()
export class Http {
    public constructor(
        private http: HttpClient,
        private rsJsonapiConfig: JsonapiConfig,
        // private $timeout,
        // private rsJsonapiConfig,
        private noDuplicatedHttpCallsService: NoDuplicatedHttpCallsService // private $q
    ) {}

    public async delete(path: string, url: string = this.rsJsonapiConfig.url): Promise<IDataObject> {
        return this.exec(url, path, 'DELETE');
    }

    public async get(path: string, url: string = this.rsJsonapiConfig.url): Promise<IDataObject> {
        return this.exec(url, path, 'get');
    }

    public async exec(
        url: string = this.rsJsonapiConfig.url,
        path: string,
        method: string,
        data?: IDataObject,
        call_loadings_error: boolean = true
    ): Promise<IDataObject> {
        let fakeHttpPromise = null;

        // http request (if we don't have any GET request yet)
        if (
            method !== 'get' ||
            !this.noDuplicatedHttpCallsService.hasPromises(path)
        ) {
            if (data) {
                data = JSON.parse(JSON.stringify(data, (key, value) => {
                    if (value === null || value === undefined) {
                        return '';
                    }
                    return value;
                }));
                const relationships = data.data.relationships;
                if (relationships) {
                    Object.keys(relationships).forEach(key => {
                        if (!relationships[key].data
                            || relationships[key].data.length === 0
                            || Object.keys(relationships[key].data).length === 0) {
                            delete data.data.relationships[key];
                        }
                    });
                }
            }
            const req = new HttpRequest(
                method,
                url + path,
                data || null,
                {
                    headers: new HttpHeaders({
                        'Content-Type': 'application/vnd.api+json',
                        'Accept': 'application/vnd.api+json'
                    })
                }
            );

            const http_observable = this.http.request(req);

            if (method === 'get') {
                this.noDuplicatedHttpCallsService.setPromiseRequest(
                    path,
                    http_observable.toPromise()
                );
            } else {
                fakeHttpPromise = http_observable.toPromise();
            }
        }
        if (fakeHttpPromise === null) {
            // method === 'get'
            fakeHttpPromise = this.noDuplicatedHttpCallsService.getAPromise(
                path
            );
        }

        const deferred: Deferred<IDataObject> = new Deferred();
        Core.me.refreshLoadings(1);
        fakeHttpPromise
            .then(success => {
                success = success.body || success;
                Core.me.refreshLoadings(-1);
                deferred.resolve(success);
            })
            .catch(error => {
                error = error.error || error;
                Core.me.refreshLoadings(-1);
                if (error.status <= 0) {
                    // offline?
                    if (!Core.me.loadingsOffline(error)) {
                        console.warn(
                            'Jsonapi.Http.exec (use JsonapiCore.loadingsOffline for catch it) error =>',
                            error
                        );
                    }
                } else {
                    if (call_loadings_error && !Core.me.loadingsError(error)) {
                        console.warn(
                            'Jsonapi.Http.exec (use JsonapiCore.loadingsError for catch it) error =>',
                            error
                        );
                    }
                }
                deferred.reject(error);
            });

        return deferred.promise;
    }
}
