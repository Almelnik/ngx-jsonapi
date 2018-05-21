import { Core } from './core';
import { Service } from './service';
import { Base } from './services/base';
import { ParentResourceService } from './parent-resource-service';
import { PathBuilder } from './services/path-builder';
// import { UrlParamsBuilder } from './services/url-params-builder';
import { Converter } from './services/converter';
import { IDataObject } from './interfaces/data-object';

import { isFunction } from 'rxjs/util/isFunction';
import { isArray } from 'rxjs/util/isArray';

import {
    IAttributes,
    ICollection,
    IExecParams,
    IParamsResource,
    IRelationships,
    IRelationship,
} from './interfaces';

export class Resource extends ParentResourceService {
    public is_new = true;
    public is_loading = false;
    public is_saving = false;
    public id = '';
    public type = '';
    public attributes: IAttributes = {};
    public relationships: IRelationships = {};
    public lastupdate: number;
    public path = '';

    public reset(): void {
        this.id = '';
        this.attributes = {};
        this.relationships = {};
        Base.forEach(this.getService().schema.relationships, (value, key) => {
            if (this.getService().schema.relationships[key].hasMany) {
                const relation: IRelationship = {
                    data: Base.newCollection(),
                    content: 'collection',
                };
                this.relationships[key] = relation;
            } else {
                const relation: IRelationship = {data: {}, content: 'none'};
                this.relationships[key] = relation;
            }
        });
        this.is_new = true;
    }

    public toObject(params?: IParamsResource): IDataObject {
        params = {...{}, ...Base.Params, ...params};

        const relationships = {};
        const included = [];
        const includedIds = []; // just for control don't repeat any resource

        // RELATIONSHIPS
        Base.forEach(
            this.relationships,
            (relationship: IRelationship, relation_alias: string) => {
                if (
                    this.getService().schema.relationships[relation_alias] &&
                    this.getService().schema.relationships[relation_alias]
                        .hasMany
                ) {
                    // has many (hasMany:true)
                    relationships[relation_alias] = {data: []};

                    Base.forEach(relationship.data, (resource: Resource) => {
                        const relational_object = {
                            id: resource.id,
                            type: resource.type,
                        };
                        relationships[relation_alias].data.push(
                            relational_object
                        );

                        // has not yet been added to included && has been asked to include with the params.include
                        const temporal_id = resource.type + '_' + resource.id;
                        if (
                            includedIds.indexOf(temporal_id) === -1 &&
                            params.include.indexOf(relation_alias) !== -1
                        ) {
                            includedIds.push(temporal_id);
                            included.push(resource.toObject({}).data);
                        }
                    });
                } else {
                    // has one (hasMany:false)

                    const relationship_data = <Resource>relationship.data;
                    if (
                        !('id' in relationship.data) &&
                        Object.keys(relationship.data).length > 0
                    ) {
                        console.warn(
                            relation_alias +
                            ' defined with hasMany:false, but I have a collection'
                        );
                    }

                    if (relationship_data.id && relationship_data.type) {
                        relationships[relation_alias] = {
                            data: {
                                id: relationship_data.id,
                                type: relationship_data.type,
                            },
                        };
                    } else {
                        relationships[relation_alias] = {data: {}};
                    }

                    // has not yet been added to included && has been asked to include with the params.include
                    const temporaryId =
                        relationship_data.type + '_' + relationship_data.id;
                    if (
                        includedIds.indexOf(temporaryId) === -1 &&
                        params.include.indexOf(relationship_data.type) !== -1
                    ) {
                        includedIds.push(temporaryId);
                        included.push(relationship_data.toObject({}).data);
                    }
                }
            }
        );

        // just for performance don't copy if not necessary
        let attributes;
        if (this.getService() && this.getService().parseToServer) {
            attributes = {...{}, ...this.attributes};
            this.getService().parseToServer(attributes);
        } else {
            attributes = this.attributes;
        }

        const ret: IDataObject = {
            data: {
                type: this.type,
                id: this.id,
                attributes: attributes,
                relationships: relationships,
            },
        };

        if (included.length > 0) {
            ret.included = included;
        }

        return ret;
    }

    public async save<T extends Resource>(
        params?: Object | Function,
        fc_success?: Function,
        fc_error?: Function
    ): Promise<object> {
        return this.__exec({
            id: null,
            params: params,
            fc_success: fc_success,
            fc_error: fc_error,
            exec_type: 'save',
        });
    }

    public async archive<T extends Resource>(
        fc_success?: Function,
        fc_error?: Function
    ): Promise<object> {
        return this.__exec({
            id: null,
            params: null,
            fc_success,
            fc_error,
            exec_type: 'archive'
        });
    }

    public async clone<T extends Resource>(
        fc_success?: Function,
        fc_error?: Function
    ): Promise<object> {
        return this.__exec({
            id: null,
            params: null,
            fc_success,
            fc_error,
            exec_type: 'clone'
        });
    }

    protected async __exec<T extends Resource>(
        exec_params: IExecParams
    ): Promise<object> {
        const exec_pp = this.proccess_exec_params(exec_params);

        switch (exec_params.exec_type) {
            case 'save':
                return this._save(
                    exec_pp.params,
                    exec_params.fc_success,
                    exec_params.fc_error
                );
            case 'clone':
            case 'archive':
                return this.customCall(
                    {method: 'POST', body: null, postfixPath: exec_params.exec_type},
                    exec_params.fc_success,
                    exec_params.fc_error
                );
        }
    }

    public async customCall<T extends Resource>(
        requestParams: {method: string, body?: IDataObject, postfixPath?: string, fullPath?: string, params?: IParamsResource},
        fc_success?,
        fc_error?): Promise<object> {
        const promiseArchive: Promise<object> = new Promise(
            (resolve, reject): void => {
                if (this.is_saving || this.is_loading) {
                    return;
                }
                this.is_saving = true;
                const path = new PathBuilder();
                path.applyParams(this.getService(), null, this.path);
                if (!this.path && this.id) {
                    path.appendPath(this.id);
                }
                path.appendPath(requestParams.postfixPath);
                const body = requestParams.body === undefined ? this.toObject(requestParams.params) : requestParams.body;
                const promise = Core.injectedServices.JsonapiHttp.exec(
                    this.getService().url,
                    requestParams.fullPath || path.get(),
                    requestParams.method,
                    body,
                    isFunction(fc_error)
                );
                promise.then(success => {
                    this.runFc(fc_success, success);
                    resolve(success);
                })
                    .catch(error => {
                        this.is_saving = false;
                        this.runFc(
                            fc_error,
                            'data' in error ? error.data : error
                        );
                        reject('data' in error ? error.data : error);
                    })
            }
        );
        return promiseArchive;
    }

    private async _save<T extends Resource>(
        params: IParamsResource,
        fc_success: Function,
        fc_error: Function
    ): Promise<object> {
        const promiseSave: Promise<object> = new Promise(
            (resolve, reject): void => {
                if (this.is_saving || this.is_loading) {
                    return;
                }
                this.is_saving = true;

                const object = this.toObject(params);

                // http request
                const path = new PathBuilder();
                path.applyParams(this.getService(), params, this.path);
                if (!this.path && this.id) {
                    path.appendPath(this.id);
                }

                const promise = Core.injectedServices.JsonapiHttp.exec(
                    this.getService().url,
                    path.get(),
                    'POST',
                    object,
                    !isFunction(fc_error)
                );

                promise
                    .then(success => {
                        this.is_saving = false;

                        // foce reload cache (for example, we add a new element)
                        if (!this.id) {
                            this.getService().cachememory.deprecateCollections(
                                path.get()
                            );
                            this.getService().cachestore.deprecateCollections(
                                path.get()
                            );
                        }

                        // is a resource?
                        if ('id' in success.data) {
                            this.id = success.data.id;
                            Converter.build(success, this);
                            /*
                                If I save it in the cache, then it is not blended with the view
                                Use {{$ ctrl.service.getCachedResources () | json}}, add a new one, edit
                            */
                            // this.getService().cachememory.setResource(this);
                        } else if (isArray(success.data)) {
                            console.warn(
                                'Server return a collection when we save()',
                                success.data
                            );

                            /*
                                we request the service again, because server maybe are giving
                                us another type of resource (getService(resource.type))
                            */
                            const temporary_collection = this.getService().cachememory.getOrCreateCollection(
                                'justAnUpdate'
                            );
                            Converter.build(
                                success,
                                temporary_collection
                            );
                            Base.forEach(
                                temporary_collection,
                                (resource_value: Resource, key: string) => {
                                    const res = Converter.getService(
                                        resource_value.type
                                    ).cachememory.resources[resource_value.id];
                                    Converter.getService(
                                        resource_value.type
                                    ).cachememory.setResource(resource_value);
                                    Converter.getService(
                                        resource_value.type
                                    ).cachestore.setResource(resource_value);
                                    res.id = res.id + 'x';
                                }
                            );

                            console.warn(
                                'Temporal collection for a resource_value update',
                                temporary_collection
                            );
                        }

                        this.runFc(fc_success, success);
                        resolve(success);
                    })
                    .catch(error => {
                        this.is_saving = false;
                        this.runFc(
                            fc_error,
                            'data' in error ? error.data : error
                        );
                        reject('data' in error ? error.data : error);
                    });
            }
        );

        return promiseSave;
    }

    public addRelationship<T extends Resource>(
        resource: T,
        type_alias?: string
    ) {
        let object_key = resource.id;
        if (!object_key) {
            object_key = 'new_' + Math.floor(Math.random() * 100000);
        }

        type_alias = type_alias ? type_alias : resource.type;
        if (!(type_alias in this.relationships)) {
            this.relationships[type_alias] = {data: {}, content: 'none'};
        }

        resource.path = `${this.path || (this.type + '/' + this.id)}/relationships/${resource.type}/${resource.id}`;
        if (
            type_alias in this.getService().schema.relationships &&
            this.getService().schema.relationships[type_alias].hasMany
        ) {
            this.relationships[type_alias].data[object_key] = resource;
        } else {
            this.relationships[type_alias].data = resource;
        }
    }

    public addRelationships(resources: ICollection, type_alias: string) {
        if (!(type_alias in this.relationships)) {
            this.relationships[type_alias] = {data: {}, content: 'none'};
        } else {
            // we receive a new collection of this relationship. We need remove old (if don't exist on new collection)
            Base.forEach(this.relationships[type_alias].data, resource => {
                if (!(resource.id in resources)) {
                    delete this.relationships[type_alias].data[resource.id];
                }
            });
        }

        Base.forEach(resources, resource => {
            resource.path = `${this.path || (this.type + '/' + this.id)}/relationships/${resource.type}/${resource.id}`;
            this.relationships[type_alias].data[resource.id] = resource;
        });
    }

    public addRelationshipsArray<T extends Resource>(
        resources: Array<T>,
        type_alias?: string
    ): void {
        resources.forEach((item: Resource) => {
            this.addRelationship(item, type_alias || item.type);
        });
    }

    public removeRelationship(type_alias: string, id: string): boolean {
        if (!(type_alias in this.relationships)) {
            return false;
        }
        if (!('data' in this.relationships[type_alias])) {
            return false;
        }

        if (
            type_alias in this.getService().schema.relationships &&
            this.getService().schema.relationships[type_alias].hasMany
        ) {
            if (!(id in this.relationships[type_alias].data)) {
                return false;
            }
            delete this.relationships[type_alias].data[id];
        } else {
            this.relationships[type_alias].data = {};
        }

        return true;
    }

    /*
        @return This resource like a service
    */
    public getService(): Service {
        return Converter.getService(this.type);
    }
}
